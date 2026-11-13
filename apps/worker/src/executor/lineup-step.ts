import { randomUUID } from "node:crypto";
import {
  appendEvent,
  insertSnapshot,
  readLeagueSettings,
  recordWriteReadback,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import {
  type LineupReadback,
  type ReviewReason,
  readBackLineupEdit,
  writeGateFor,
} from "@injurysub/domain";
import type { EspnErrorCode, TeamDay } from "@injurysub/espn";
import { systemEvent } from "./claim";
import { mayRunAgain, pollReadback, recordAnswer, recordNotSent, sendWrite } from "./espn-write";
import { type PreflightOutcome, readEspn, type WriteStepContext } from "./preflight";
import { moveToReview, putBackInLine, type RequeueOutcome, type ReviewOutcome } from "./review";

export type ClaimedForLineup = Extract<PreflightOutcome, { kind: "claimed"; resumeAt: "lineup" }>;

export type LineupStepContext = WriteStepContext;

export type LineupStepOutcome =
  | { kind: "lineup_verified"; request: SubRequestRecord; effectiveDay: number }
  | ReviewOutcome
  | RequeueOutcome
  | { kind: "unsettled" }
  | { kind: "rehearsed"; request: SubRequestRecord; day: number; writeId: string };

// Sends the claimed edit to ESPN from the day preflight checked, reads ESPN back, and settles the
// lineup by what ESPN shows, never by its answer (X10): verified with its effective day, the
// commissioner's as ambiguous or failed, or unsettled while ESPN can't be read. With sending
// switched off the body is recorded and the run goes on as a rehearsal.
export async function runLineupStep(
  context: LineupStepContext,
  claimed: ClaimedForLineup
): Promise<LineupStepOutcome> {
  const { request, edit, teamWeek } = claimed;
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") return review(context, request, gate, {}, {});
  const scoringPeriodId = teamWeek.week.todayScoringPeriodId;
  const sent = await sendWrite(
    context,
    {
      requestId: request.requestId,
      kind: "lineup",
      teamId: request.teamId,
      matchupId: request.matchupId,
      scoringPeriodId,
    },
    new Set(settings.writeAllowlist),
    (write, guard) =>
      write.applyLineup({ teamId: request.teamId, scoringPeriodId, moves: edit.items }, guard)
  );
  if (sent.kind === "lost") return { kind: "lost" };
  if (sent.kind === "recorded_only") {
    return rehearse(context, request, { writeId: sent.writeId, day: scoringPeriodId });
  }
  const answered = await recordAnswer(context, request, sent, {
    patch: { lineupState: "sent" },
    eventType: "lineup_sent",
    payload: {},
  });
  if (answered === null) return { kind: "lost" };
  const readback = await readBack(context, claimed, sent.failureCode);
  if (readback === null) return { kind: "unsettled" };
  return settleLineup(context, answered, sent, readback);
}

// The body was recorded, not sent: the request is marked a rehearsal, and its lineup stays pending
// with no effective day, since nothing is on ESPN and nothing was read back (S12). The day the
// body named stands in for the effective day in the adjustment's math.
async function rehearse(
  context: LineupStepContext,
  request: SubRequestRecord,
  recorded: { writeId: string; day: number }
): Promise<LineupStepOutcome> {
  await recordNotSent(context, recorded.writeId);
  const row = await transitionRequest(context.connection.db, {
    requestId: request.requestId,
    fromStatus: request.status,
    version: request.version,
    patch: { isRehearsal: true },
    now: context.clock(),
  });
  return row === null ? { kind: "lost" } : { kind: "rehearsed", request: row, ...recorded };
}

export type ReadBack = { readback: LineupReadback; days: TeamDay[] };

// The team's days from the one sent through the matchup's last, read until the edit shows.
function readBack(
  context: LineupStepContext,
  { request, edit, teamWeek }: ClaimedForLineup,
  failureCode: EspnErrorCode | null
): Promise<ReadBack | null> {
  const first = teamWeek.week.todayScoringPeriodId;
  const last = Math.max(...teamWeek.week.scoringPeriodIds);
  const readOnce = async () => {
    const days = await readDays(context, request.teamId, first, last);
    return days === null
      ? null
      : { readback: readBackLineupEdit({ items: edit.items, days }), days };
  };
  return pollReadback(
    context,
    failureCode,
    readOnce,
    (read) => read.readback.outcome === "applied"
  );
}

// The team's days from `first` through `last`, recording what the reads say about ESPN access.
export async function readDays(
  context: LineupStepContext,
  teamId: number,
  first: number,
  last: number
): Promise<TeamDay[] | null> {
  const dayIds = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const reads = await readEspn(context, () =>
    Promise.all(dayIds.map((day) => context.espn.getTeamDay(teamId, day)))
  );
  return "code" in reads ? null : reads.value.map((read) => read.day);
}

// What a readback of a lineup write settles: verified from its effective day; nothing on ESPN,
// which goes back in line after an answer that left it open (O6) and to the commissioner after
// a 200 or a refusal (X15); or ambiguous (X14). Recovery settles an interrupted write the same way.
export async function settleLineup(
  context: LineupStepContext,
  request: SubRequestRecord,
  sent: { writeId: string; failureCode: string | null },
  { readback, days }: ReadBack
): Promise<LineupStepOutcome> {
  const { writeId, failureCode } = sent;
  const outcome = readback.outcome === "applied" ? "verified" : readback.outcome;
  await recordWriteReadback(context.connection.db, writeId, { outcome, readback: readback.days });
  if (readback.outcome === "applied") {
    return verify(context, request, { writeId, effectiveDay: readback.effectiveDay, days });
  }
  if (readback.outcome === "not_applied" && mayRunAgain(failureCode)) {
    const found = { writeId, failureCode };
    return putBackInLine(context, request, { lineupState: "pending", found, at: context.clock() });
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
