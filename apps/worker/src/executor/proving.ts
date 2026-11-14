import {
  appendEvent,
  listWriteAttempts,
  readLeagueSettings,
  recordWriteReadback,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import {
  ADJUSTMENT_REASON_MAX_LENGTH,
  executorTransition,
  inverseEdit,
  type LineupMove,
  type ProvingTokenPlan,
  planProvingToken,
  type ReviewReason,
  readBackLineupEdit,
  toTenths,
  writeGateFor,
} from "@injurysub/domain";
import {
  type AdjustmentStepOutcome,
  type MatchupNow,
  readMatchup,
  sendAndReadBack,
  sideOf,
} from "./adjustment-step";
import { systemEvent } from "./claim";
import { pollReadback, recordAnswer, sendWrite } from "./espn-write";
import {
  type ClaimedForLineup,
  type LineupStepOutcome,
  readDays,
  runLineupStep,
} from "./lineup-step";
import { type PreflightOutcome, readEspn, type WriteStepContext } from "./preflight";
import { moveToReview, type ReviewOutcome } from "./review";

export type ProvingRunOutcome = LineupStepOutcome | AdjustmentStepOutcome;

// Where a proving run stopped, as its review event names it.
type ProvingStep = "before_swap" | "token" | "revert" | "restore" | "interrupted";
type Token = Extract<ProvingTokenPlan, { ok: true }>;
type TokenRefusal = Extract<ProvingTokenPlan, { ok: false }>["refusal"] | "not_current";
// A step that went through, or the outcome the run ends with.
type Stepped<T> = T | { stopped: ProvingRunOutcome };
type Adjusted = { request: SubRequestRecord; read: MatchupNow };

// The proving request (S9, S5): the production path, run on team 1 and undone. The swap goes
// through the lineup step unchanged; then a 0.1 adjustment with the test note, its revert, and
// the lineup put back with the swap's items reversed, each sent behind its attempt row and read
// back before the next. Anything not confirmed on ESPN stops the run for the commissioner with
// nothing more sent; an interrupted run is never picked up where it stopped.
export async function runProvingRun(
  context: WriteStepContext,
  claimed: Extract<PreflightOutcome, { kind: "claimed" }>
): Promise<ProvingRunOutcome> {
  if (claimed.resumeAt === "adjustment") {
    return stop(context, claimed.request, "interrupted", "resumed");
  }
  const refused = await refuseBeforeSwap(context, claimed.request);
  if (refused !== null) return refused;
  const swap = await runLineupStep(context, claimed);
  if (swap.kind !== "lineup_verified") return swap;
  const token = await writeToken(context, swap.request);
  if ("stopped" in token) return token.stopped;
  const reverted = await revertToken(context, token);
  if ("stopped" in reverted) return reverted.stopped;
  return restoreLineup(context, reverted.request, claimed);
}

// What the token needs is known before the swap: a side that can't take it stops the run with
// nothing on ESPN (AC5-3). While ESPN can't be read, nothing is sent; recovery puts it back in line.
async function refuseBeforeSwap(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<ProvingRunOutcome | null> {
  const now = await readMatchup(context, request);
  if (now === null) return { kind: "unsettled" };
  const token = tokenFor(now, request.teamId);
  if (token.ok) return null;
  return stop(context, request, "before_swap", token.refusal, "adjustment_failed");
}

function tokenFor(
  now: MatchupNow | "not_current",
  teamId: number
): Token | { ok: false; refusal: TokenRefusal } {
  if (now === "not_current") return { ok: false, refusal: "not_current" };
  const side = sideOf(now.matchup, teamId);
  const current = {
    currentTenths: toTenths(side.adjustment),
    currentReason: side.adjustmentReason ?? "",
  };
  return planProvingToken(current, ADJUSTMENT_REASON_MAX_LENGTH);
}

// The side as read is recorded before the token goes out, so what to put back is on record even
// if the run stops between the send and its answer (AC5-4).
async function writeToken(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<Stepped<Adjusted & { token: Token }>> {
  const now = await readMatchup(context, request);
  if (now === null) return { stopped: await stop(context, request, "token", "espn_unread") };
  const token = tokenFor(now, request.teamId);
  if (!token.ok || now === "not_current") {
    const refusal = token.ok ? "not_current" : token.refusal;
    return { stopped: await stop(context, request, "token", refusal, "adjustment_failed") };
  }
  const { tenths, reason } = token.original;
  const payload = { proving: "token", tenths, reason };
  await appendEvent(
    context.connection.db,
    request.requestId,
    systemEvent("proving_side_read", payload, context.clock())
  );
  const write = { now, targetTenths: token.targetTenths, reason: token.reason };
  const adjusted = await adjust(context, request, "token", write);
  return "stopped" in adjusted ? adjusted : { ...adjusted, token };
}

// The side back to its value and note as read before the token, the opponent's side as read back
// a moment before.
function revertToken(
  context: WriteStepContext,
  token: Adjusted & { token: Token }
): Promise<Stepped<Adjusted>> {
  const { tenths, reason } = token.token.original;
  return adjust(context, token.request, "revert", {
    now: token.read,
    targetTenths: tenths,
    reason,
  });
}

// One adjustment of the run through the production send and readback; the answer leaves the
// request's adjustment state alone, since none is owed.
async function adjust(
  context: WriteStepContext,
  request: SubRequestRecord,
  step: "token" | "revert",
  write: { now: MatchupNow; targetTenths: number; reason: string }
): Promise<Stepped<Adjusted>> {
  const readNow = () => readMatchup(context, request);
  const answer = { patch: {}, payload: { proving: step, targetTenths: write.targetTenths } };
  const sent = await sendAndReadBack(context, request, { ...write, readNow }, answer);
  if (sent.kind === "lost" || sent.kind === "unsettled") return { stopped: sent };
  if (sent.kind !== "read") return { stopped: await stop(context, request, step, sent.kind) };
  if (!sent.verified) return { stopped: await stop(context, sent.request, step, "not_applied") };
  const verified = { proving: step, writeId: sent.writeId };
  await appendEvent(
    context.connection.db,
    sent.request.requestId,
    systemEvent("adjustment_verified", verified, context.clock())
  );
  return { request: sent.request, read: sent.read };
}

// The swap's items reversed, for the swap's own day: an LM edit covers the whole ESPN day, so one
// landing after the day change would leave the swap on the earlier day (S5, AC1-8).
async function restoreLineup(
  context: WriteStepContext,
  request: SubRequestRecord,
  claimed: ClaimedForLineup
): Promise<ProvingRunOutcome> {
  const day = claimed.teamWeek.week.todayScoringPeriodId;
  const read = await readEspn(context, () => context.espn.getLineup(request.teamId));
  if ("code" in read) return stop(context, request, "restore", "espn_unread");
  if (read.value.meta.scoringPeriodId !== day)
    return stop(context, request, "restore", "day_changed");
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") return stop(context, request, "restore", gate);
  const items = inverseEdit(claimed.edit.items);
  const { teamId, matchupId } = request;
  const attempt = { requestId: request.requestId, kind: "lineup" as const, teamId, matchupId };
  const sent = await sendWrite(
    context,
    { ...attempt, scoringPeriodId: day },
    new Set(settings.writeAllowlist),
    (write, guard) => write.applyLineup({ teamId, scoringPeriodId: day, moves: items }, guard)
  );
  if (sent.kind === "lost") return { kind: "lost" };
  if (sent.kind === "recorded_only") return stop(context, request, "restore", "recorded_only");
  const change = { patch: {}, eventType: "lineup_sent" as const, payload: { proving: "restore" } };
  const answered = await recordAnswer(context, request, sent, change);
  if (answered === null) return { kind: "lost" };
  const last = Math.max(...claimed.teamWeek.week.scoringPeriodIds);
  return readBackRestore(context, answered, { ...sent, items, day, last });
}

async function readBackRestore(
  context: WriteStepContext,
  request: SubRequestRecord,
  sent: { writeId: string; failureCode: Parameters<typeof pollReadback>[1] } & {
    items: LineupMove[];
    day: number;
    last: number;
  }
): Promise<ProvingRunOutcome> {
  const readOnce = async () => {
    const days = await readDays(context, request.teamId, sent.day, sent.last);
    return days === null ? null : readBackLineupEdit({ items: sent.items, days });
  };
  const applied = (read: { outcome: string }) => read.outcome === "applied";
  const readback = await pollReadback(context, sent.failureCode, readOnce, applied);
  if (readback === null) return { kind: "unsettled" };
  const outcome = readback.outcome === "applied" ? "verified" : readback.outcome;
  await recordWriteReadback(context.connection.db, sent.writeId, {
    outcome,
    readback: readback.days,
  });
  if (readback.outcome !== "applied") return stop(context, request, "restore", readback.outcome);
  return completeProving(context, request, { writeId: sent.writeId, day: sent.day });
}

// Team 1 is as it was: completed with nothing on ESPN, no effective day and no adjustment owed.
async function completeProving(
  context: WriteStepContext,
  request: SubRequestRecord,
  restored: { writeId: string; day: number }
): Promise<ProvingRunOutcome> {
  const next = executorTransition(request, { type: "complete" });
  if (!next.ok) return { kind: "lost" };
  const attempts = await listWriteAttempts(context.connection.db, request.requestId);
  const verifiedAt = context.clock();
  const completedAt = context.clock();
  const row = await context.connection.transaction(async (tx) => {
    const moved = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: {
        status: next.status,
        lineupState: "pending",
        effectiveDay: null,
        adjustmentState: "not_owed",
        finalAdjustmentTenths: 0,
      },
      now: completedAt,
    });
    if (moved === null) return null;
    const verified = { proving: "restore", writeId: restored.writeId };
    await appendEvent(tx, moved.requestId, systemEvent("lineup_verified", verified, verifiedAt));
    const writeIds = attempts.map((attempt) => attempt.writeId);
    const done = { proving: true, day: restored.day, writeIds };
    await appendEvent(tx, moved.requestId, systemEvent("completed", done, completedAt));
    return moved;
  });
  return row === null ? { kind: "lost" } : { kind: "completed", request: row, finalTenths: 0 };
}

// The run stops for the commissioner, the review event naming the step and why; nothing more is
// sent, and what is on ESPN stays as the run left it (S15).
function stop(
  context: WriteStepContext,
  request: SubRequestRecord,
  step: ProvingStep,
  detail: string,
  reason: ReviewReason = "ambiguous"
): Promise<ReviewOutcome> {
  const found = { proving: step, detail };
  return moveToReview(context, request, { reason, found, patch: {}, at: context.clock() });
}
