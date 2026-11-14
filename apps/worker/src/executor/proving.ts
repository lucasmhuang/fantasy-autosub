import {
  appendEvent,
  listWriteAttempts,
  type RequestPatch,
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
import {
  pollReadback,
  recordAnswer,
  recordNotSent,
  type SendResult,
  sendWrite,
} from "./espn-write";
import {
  type ClaimedForLineup,
  type LineupStepOutcome,
  readDays,
  runLineupStep,
} from "./lineup-step";
import { type PreflightOutcome, readEspn, type WriteStepContext } from "./preflight";
import { moveToReview, putBackInLine, type ReviewOutcome } from "./review";

export type ProvingRunOutcome = LineupStepOutcome | AdjustmentStepOutcome;

// Where a proving run stopped, as its review event names it.
type ProvingStep = "before_swap" | "token" | "revert" | "restore" | "interrupted";
type Token = Extract<ProvingTokenPlan, { ok: true }>;
type TokenRefusal = Extract<ProvingTokenPlan, { ok: false }>["refusal"] | "not_current";
// A step that went through, or the outcome the run ends with.
type Stepped<T> = T | { stopped: ProvingRunOutcome };
type Adjusted = { request: SubRequestRecord; read: MatchupNow };
type Rehearsed = Extract<LineupStepOutcome, { kind: "rehearsed" }>;
type Stop = {
  step: ProvingStep;
  detail: string;
  reason?: ReviewReason;
  patch?: RequestPatch;
  found?: Record<string, unknown>;
};

// The proving request (S9, S5): the production path, run on team 1 and undone. The swap goes
// through the lineup step unchanged; then a 0.1 adjustment with the test note, its revert, and
// the lineup put back with the swap's items reversed, each sent behind its attempt row and read
// back before the next. Anything not confirmed on ESPN stops the run for the commissioner with
// nothing more sent; an interrupted run is never picked up where it stopped (S15, S16).
export async function runProvingRun(
  context: WriteStepContext,
  claimed: Extract<PreflightOutcome, { kind: "claimed" }>
): Promise<ProvingRunOutcome> {
  if (claimed.resumeAt === "adjustment") return stopInterrupted(context, claimed.request);
  const refused = await refuseBeforeSwap(context, claimed);
  if (refused !== null) return refused;
  const swap = await runLineupStep(context, claimed);
  if (swap.kind === "rehearsed") return rehearseRun(context, swap, claimed);
  if (swap.kind !== "lineup_verified") return swap;
  const token = await writeToken(context, swap.request);
  if ("stopped" in token) return token.stopped;
  const reverted = await revertToken(context, token);
  if ("stopped" in reverted) return reverted.stopped;
  return restoreLineup(context, reverted.request, claimed);
}

// A proving run a restart or a lost lease cut short, with its swap on ESPN or possibly there: it
// goes to the commissioner, nothing more sent (S16).
export function stopInterrupted(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<ReviewOutcome> {
  return stop(context, request, { step: "interrupted", detail: "restarted" });
}

// What the token needs is known before the swap: a side that can't take it stops the run with
// nothing on ESPN (AC5-3). While ESPN can't be read, nothing is sent; recovery puts it back in line.
// The same read gives ESPN's day: once it has moved on from the day the claim checked, the swap
// would name a finished day, so the request goes back in line to run for the new one (S5).
async function refuseBeforeSwap(
  context: WriteStepContext,
  { request, teamWeek }: ClaimedForLineup
): Promise<ProvingRunOutcome | null> {
  const now = await readMatchup(context, request);
  if (now === null) return { kind: "unsettled" };
  if (now !== "not_current" && now.day !== teamWeek.week.todayScoringPeriodId) {
    const found = { detail: "day_changed" };
    return putBackInLine(context, request, { lineupState: "pending", found, at: context.clock() });
  }
  const token = tokenFor(now, request.teamId);
  if (token.ok) return null;
  const refusal = { step: "before_swap" as const, detail: token.refusal };
  return stop(context, request, { ...refusal, reason: "adjustment_failed" });
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

// The side as ESPN shows it now and the token planned on it, checked again after the swap.
async function readToken(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<Stepped<{ now: MatchupNow; token: Token }>> {
  const now = await readMatchup(context, request);
  if (now === null) {
    return { stopped: await stop(context, request, { step: "token", detail: "espn_unread" }) };
  }
  const token = tokenFor(now, request.teamId);
  if (!token.ok || now === "not_current") {
    const detail = token.ok ? "not_current" : token.refusal;
    const refusal = { step: "token" as const, detail, reason: "adjustment_failed" as const };
    return { stopped: await stop(context, request, refusal) };
  }
  return { now, token };
}

// The side as read is recorded before the token goes out, so what to put back is on record even
// if the run stops between the send and its answer (AC5-4).
async function writeToken(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<Stepped<Adjusted & { token: Token }>> {
  const read = await readToken(context, request);
  if ("stopped" in read) return read;
  const { now, token } = read;
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
// a moment before. A revert that doesn't read back leaves on its stop what to put back by hand.
function revertToken(
  context: WriteStepContext,
  token: Adjusted & { token: Token }
): Promise<Stepped<Adjusted>> {
  const { tenths, reason } = token.token.original;
  const write = { now: token.read, targetTenths: tenths, reason };
  return adjust(context, token.request, "revert", write, { original: { tenths, reason } });
}

// One adjustment of the run through the production send and readback; the answer leaves the
// request's adjustment state alone, since none is owed. ESPN's readback decides it, never the
// answer: an answer lost on the way back is no stop when ESPN shows the write.
async function adjust(
  context: WriteStepContext,
  request: SubRequestRecord,
  step: "token" | "revert",
  write: { now: MatchupNow; targetTenths: number; reason: string },
  found: Record<string, unknown> = {}
): Promise<Stepped<Adjusted>> {
  const readNow = () => readMatchup(context, request);
  const answer = { patch: {}, payload: { proving: step, targetTenths: write.targetTenths } };
  const sent = await sendAndReadBack(context, request, { ...write, readNow }, answer);
  if (sent.kind === "lost" || sent.kind === "unsettled") return { stopped: sent };
  if (sent.kind === "gate_closed") {
    return {
      stopped: await stop(context, request, { step, detail: sent.gate, reason: sent.gate }),
    };
  }
  if (sent.kind !== "read") {
    return { stopped: await stop(context, request, { step, detail: sent.kind }) };
  }
  if (!sent.verified) {
    const failed = { step, detail: "not_applied", reason: "adjustment_failed" as const };
    const why = { failureCode: sent.failureCode, ...found };
    return { stopped: await stop(context, sent.request, { ...failed, found: why }) };
  }
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
  if ("code" in read) return stop(context, request, { step: "restore", detail: "espn_unread" });
  if (read.value.meta.scoringPeriodId !== day)
    return stop(context, request, { step: "restore", detail: "day_changed" });
  const restore = await sendRestore(context, request, claimed);
  if ("stopped" in restore) return restore.stopped;
  const { sent, items } = restore;
  if (sent.kind === "lost") return { kind: "lost" };
  if (sent.kind === "recorded_only") {
    return stop(context, request, { step: "restore", detail: "recorded_only" });
  }
  const change = { patch: {}, eventType: "lineup_sent" as const, payload: { proving: "restore" } };
  const answered = await recordAnswer(context, request, sent, change);
  if (answered === null) return { kind: "lost" };
  const last = Math.max(...claimed.teamWeek.week.scoringPeriodIds);
  return readBackRestore(context, answered, { ...sent, items, day, last });
}

// The restore sent behind its attempt row, the allowlist read again first.
async function sendRestore(
  context: WriteStepContext,
  request: SubRequestRecord,
  claimed: ClaimedForLineup
): Promise<Stepped<{ sent: SendResult; items: LineupMove[] }>> {
  const day = claimed.teamWeek.week.todayScoringPeriodId;
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") {
    const closed = { step: "restore" as const, detail: gate, reason: gate };
    return { stopped: await stop(context, request, closed) };
  }
  const items = inverseEdit(claimed.edit.items);
  const { teamId, matchupId } = request;
  const attempt = { requestId: request.requestId, kind: "lineup" as const, teamId, matchupId };
  const sent = await sendWrite(
    context,
    { ...attempt, scoringPeriodId: day },
    new Set(settings.writeAllowlist),
    (write, guard) => write.applyLineup({ teamId, scoringPeriodId: day, moves: items }, guard)
  );
  return { sent, items };
}

// Team 1 is back only if ESPN shows every item restored from the swap's own day: one shown only
// from a later day leaves the swap's day swapped (AC5-6); half an edit leaves the lineup unclear.
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
  const step = "restore" as const;
  if (readback.outcome !== "applied") {
    const patch = readback.outcome === "ambiguous" ? { lineupState: "ambiguous" as const } : {};
    return stop(context, request, { step, detail: readback.outcome, patch });
  }
  if (readback.effectiveDay !== sent.day) {
    return stop(context, request, { step, detail: "day_changed" });
  }
  return completeProving(context, request, { writeId: sent.writeId, day: sent.day });
}

// With sending off nothing reaches ESPN: the swap's body was recorded, and so are the token's,
// the revert's and the restore's, the token planned on the side as ESPN shows it now. Nothing is
// read back, and the run completes as a rehearsal (S17).
async function rehearseRun(
  context: WriteStepContext,
  swap: Rehearsed,
  claimed: ClaimedForLineup
): Promise<ProvingRunOutcome> {
  const { request } = swap;
  const read = await readToken(context, request);
  if ("stopped" in read) return read.stopped;
  const { now, token } = read;
  const { original } = token;
  const writes = [
    { now, targetTenths: token.targetTenths, reason: token.reason },
    { now, targetTenths: original.tenths, reason: original.reason },
  ];
  for (const write of writes) {
    const recorded = await recordAdjustmentOnly(context, request, write);
    if (recorded !== null) return recorded;
  }
  const restore = await sendRestore(context, request, claimed);
  if ("stopped" in restore) return restore.stopped;
  if (restore.sent.kind !== "recorded_only") return { kind: "lost" };
  await recordNotSent(context, restore.sent.writeId);
  const done = { writeId: restore.sent.writeId, day: swap.day, rehearsal: true };
  return completeProving(context, request, done);
}

// An adjustment body recorded with sending off; null once recorded.
async function recordAdjustmentOnly(
  context: WriteStepContext,
  request: SubRequestRecord,
  write: { now: MatchupNow; targetTenths: number; reason: string }
): Promise<ProvingRunOutcome | null> {
  const readNow = () => readMatchup(context, request);
  const sent = await sendAndReadBack(
    context,
    request,
    { ...write, readNow },
    { patch: {}, payload: {} }
  );
  if (sent.kind === "recorded_only") {
    await recordNotSent(context, sent.writeId);
    return null;
  }
  if (sent.kind === "gate_closed") {
    return stop(context, request, { step: "token", detail: sent.gate, reason: sent.gate });
  }
  return sent.kind === "lost" ? sent : stop(context, request, { step: "token", detail: sent.kind });
}

// Team 1 is as it was: completed with nothing on ESPN, no effective day and no adjustment owed. A
// rehearsal's restore was only recorded, so no readback is kept for it.
async function completeProving(
  context: WriteStepContext,
  request: SubRequestRecord,
  restored: { writeId: string; day: number; rehearsal?: boolean }
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
    if (restored.rehearsal !== true) {
      await appendEvent(tx, moved.requestId, systemEvent("lineup_verified", verified, verifiedAt));
    }
    const writeIds = attempts.map((attempt) => attempt.writeId);
    const rehearsal = restored.rehearsal === true ? { rehearsal: true } : {};
    const done = { proving: true, day: restored.day, writeIds, ...rehearsal };
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
  { step, detail, reason = "ambiguous", patch = {}, found = {} }: Stop
): Promise<ReviewOutcome> {
  const record = { proving: step, detail, ...found };
  return moveToReview(context, request, { reason, found: record, patch, at: context.clock() });
}
