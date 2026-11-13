import { randomUUID } from "node:crypto";
import { AppError } from "@injurysub/config";
import {
  appendEvent,
  insertSnapshot,
  readLeagueSettings,
  recordWriteAnswer,
  recordWriteAttempt,
  recordWriteReadback,
  type SubRequestRecord,
  transitionRequest,
  type WriteLease,
} from "@injurysub/db";
import {
  type LineupReadback,
  type ReviewReason,
  readBackLineupEdit,
  writeGateFor,
} from "@injurysub/domain";
import {
  EspnError,
  type EspnErrorCode,
  type EspnWriteClient,
  type TeamDay,
  type WriteGuard,
} from "@injurysub/espn";
import { LEASE_TTL_SECONDS, systemEvent } from "./claim";
import type { ExecutorContext, PreflightOutcome } from "./preflight";
import { moveToReview, type ReviewOutcome } from "./review";

export type ClaimedForLineup = Extract<PreflightOutcome, { kind: "claimed"; resumeAt: "lineup" }>;

export type LineupStepContext = ExecutorContext & { lease: WriteLease; write: EspnWriteClient };

export type LineupStepOutcome =
  | { kind: "lineup_verified"; request: SubRequestRecord; effectiveDay: number }
  | ReviewOutcome
  | { kind: "unsettled" }
  | { kind: "recorded_only" };

// ESPN showed a lineup edit within a second of its answer in every write so far (2026-10-29: 0.3
// s), so five reads two seconds apart leave room; one read for an answer that declined it.
const READBACK_ROUNDS = 5;
const READBACK_INTERVAL_MS = 2_000;

// The fencing check before a send found another worker holding the lease: nothing may be sent.
export class WriteLeaseLostError extends AppError {
  override readonly name = "WriteLeaseLostError";
}

type SendResult =
  | { kind: "answered"; writeId: string; failureCode: EspnErrorCode | null }
  | { kind: "recorded_only"; writeId: string }
  | { kind: "lost" };

// Sends the claimed edit to ESPN from the day preflight checked, reads ESPN back, and settles the
// lineup by what ESPN shows, never by its answer (X10): verified with its effective day, the
// commissioner's as ambiguous or failed, or unsettled while ESPN can't be read.
export async function runLineupStep(
  context: LineupStepContext,
  claimed: ClaimedForLineup
): Promise<LineupStepOutcome> {
  const { request } = claimed;
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") return review(context, request, gate, {}, {});
  const sent = await sendEdit(context, claimed, new Set(settings.writeAllowlist));
  if (sent.kind === "lost") return { kind: "lost" };
  if (sent.kind === "recorded_only") {
    await recordWriteAnswer(context.connection.db, sent.writeId, {
      status: "recorded_only",
      failureCode: null,
    });
    return { kind: "recorded_only" };
  }
  const answered = await recordAnswer(context, request, sent);
  if (answered === null) return { kind: "lost" };
  const rounds = mayHaveApplied(sent.failureCode) ? READBACK_ROUNDS : 1;
  const readback = await readBack(context, claimed, rounds);
  if (readback === null) return { kind: "unsettled" };
  return settle(context, answered, sent, readback);
}

// What ESPN's answer leaves open: an accepted write, or one whose answer never came back.
function mayHaveApplied(failureCode: EspnErrorCode | null): boolean {
  return failureCode === null || failureCode === "outcome_unknown";
}

// The attempt is committed, behind the fencing check, before the body leaves (AC2-10).
async function sendEdit(
  context: LineupStepContext,
  { request, edit, teamWeek }: ClaimedForLineup,
  allowlist: ReadonlySet<number>
): Promise<SendResult> {
  const writeId = randomUUID();
  const scoringPeriodId = teamWeek.week.todayScoringPeriodId;
  const guard: WriteGuard = {
    allowlist,
    beforeSend: async (body) => {
      const recorded = await recordWriteAttempt(context.connection, {
        lease: context.lease,
        ttlSeconds: LEASE_TTL_SECONDS,
        attempt: {
          writeId,
          requestId: request.requestId,
          kind: "lineup",
          teamId: request.teamId,
          matchupId: request.matchupId,
          scoringPeriodId,
          body,
        },
      });
      if (recorded === null) throw new WriteLeaseLostError("another worker holds the lease");
    },
  };
  try {
    const write = { teamId: request.teamId, scoringPeriodId, moves: edit.items };
    const result = await context.write.applyLineup(write, guard);
    if (result.outcome === "recorded_only") return { kind: "recorded_only", writeId };
    return { kind: "answered", writeId, failureCode: null };
  } catch (error) {
    if (error instanceof WriteLeaseLostError) return { kind: "lost" };
    if (error instanceof EspnError) return { kind: "answered", writeId, failureCode: error.code };
    throw error;
  }
}

// ESPN's answer on the attempt, and the request marked as sent, with its event.
async function recordAnswer(
  context: LineupStepContext,
  request: SubRequestRecord,
  sent: { writeId: string; failureCode: EspnErrorCode | null }
): Promise<SubRequestRecord | null> {
  const { writeId, failureCode } = sent;
  await recordWriteAnswer(context.connection.db, writeId, {
    status: failureCode === null ? "answered" : "failed",
    failureCode,
  });
  const at = context.clock();
  return context.connection.transaction(async (tx) => {
    const row = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: { lineupState: "sent" },
      now: at,
    });
    if (row === null) return null;
    await appendEvent(tx, row.requestId, systemEvent("lineup_sent", { writeId, failureCode }, at));
    return row;
  });
}

type ReadBack = { readback: LineupReadback; days: TeamDay[] };

// The team's days from the one sent through the matchup's last, read until the edit shows or the
// rounds run out; the last round read decides. Null when no round could be read.
async function readBack(
  context: LineupStepContext,
  { request, edit, teamWeek }: ClaimedForLineup,
  rounds: number
): Promise<ReadBack | null> {
  const first = teamWeek.week.todayScoringPeriodId;
  const last = Math.max(...teamWeek.week.scoringPeriodIds);
  let latest: ReadBack | null = null;
  for (let round = 0; round < rounds; round += 1) {
    if (round > 0) await context.sleep(READBACK_INTERVAL_MS);
    const days = await readDays(context, request.teamId, first, last);
    if (days === null) continue;
    latest = { readback: readBackLineupEdit({ items: edit.items, days }), days };
    if (latest.readback.outcome === "applied") return latest;
  }
  return latest;
}

async function readDays(
  context: LineupStepContext,
  teamId: number,
  first: number,
  last: number
): Promise<TeamDay[] | null> {
  const dayIds = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  try {
    const reads = await Promise.all(dayIds.map((day) => context.espn.getTeamDay(teamId, day)));
    return reads.map((read) => read.day);
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    context.logger.warn("worker.executor.readback_unread", { teamId, code: error.code });
    return null;
  }
}

async function settle(
  context: LineupStepContext,
  request: SubRequestRecord,
  sent: { writeId: string; failureCode: EspnErrorCode | null },
  { readback, days }: ReadBack
): Promise<LineupStepOutcome> {
  const { writeId, failureCode } = sent;
  const outcome = readback.outcome === "applied" ? "verified" : readback.outcome;
  await recordWriteReadback(context.connection.db, writeId, { outcome, readback: readback.days });
  if (readback.outcome === "applied") {
    return verify(context, request, { writeId, effectiveDay: readback.effectiveDay, days });
  }
  if (readback.outcome === "not_applied") {
    const found = { writeId, failureCode };
    return review(context, request, "lineup_failed", found, { lineupState: "failed" });
  }
  return review(context, request, "ambiguous", { writeId }, { lineupState: "ambiguous" });
}

// The lineup is done on ESPN: its state, the effective day, a snapshot of the days read back and
// the event, together. The request stays executing for the adjustment.
async function verify(
  context: LineupStepContext,
  request: SubRequestRecord,
  verified: { writeId: string; effectiveDay: number; days: TeamDay[] }
): Promise<LineupStepOutcome> {
  const { writeId, effectiveDay, days } = verified;
  const at = context.clock();
  const row = await context.connection.transaction(async (tx) => {
    const moved = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: { lineupState: "verified", effectiveDay },
      now: at,
    });
    if (moved === null) return null;
    await insertSnapshot(tx, moved.requestId, "lineup_verified", {
      snapshotId: randomUUID(),
      espnDay: Math.min(...days.map((day) => day.scoringPeriodId)),
      takenAt: at,
      payload: { effectiveDay, days },
    });
    const payload = { writeId, effectiveDay };
    await appendEvent(tx, moved.requestId, systemEvent("lineup_verified", payload, at));
    return moved;
  });
  return row === null ? { kind: "lost" } : { kind: "lineup_verified", request: row, effectiveDay };
}

function review(
  context: LineupStepContext,
  request: SubRequestRecord,
  reason: ReviewReason,
  found: Record<string, unknown>,
  patch: { lineupState?: "failed" | "ambiguous" }
): Promise<ReviewOutcome> {
  return moveToReview(context, request, { reason, found, patch, at: context.clock() });
}
