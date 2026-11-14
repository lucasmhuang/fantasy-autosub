import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  findEarlierCreditingRequest,
  getRequestDetail,
  insertSnapshot,
  type RequestPatch,
  readLeagueSettings,
  recordWriteReadback,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import {
  ADJUSTMENT_REASON_MAX_LENGTH,
  type AdjustmentDecision,
  type AdjustmentLine,
  type AdjustmentResult,
  adjustmentReasonEntry,
  composeReason,
  computeAdjustment,
  decideAdjustment,
  executorTransition,
  findRequestEntry,
  playerDayPoints,
  type ReviewReason,
  targetSideAdjustment,
  toTenths,
  type WriteGate,
  writeGateFor,
} from "@injurysub/domain";
import {
  type AdjustmentWrite,
  type LeagueRulesRead,
  type SideAdjustment,
  type TeamWeekRead,
} from "@injurysub/espn";
import { z } from "zod";
import { systemEvent } from "./claim";
import {
  mayRunAgain,
  pollReadback,
  recordAnswer,
  recordNotSent,
  type SendResult,
  sendWrite,
} from "./espn-write";
import { readEspn, type WriteStepContext } from "./preflight";
import { moveToReview, putBackInLine, type RequeueOutcome, type ReviewOutcome } from "./review";

export type AdjustmentStepOutcome =
  | { kind: "completed"; request: SubRequestRecord; finalTenths: number }
  | ReviewOutcome
  | RequeueOutcome
  | { kind: "unsettled" };

// A run with sending switched off: the lineup body was recorded, not sent, so the day it named
// stands in for the effective day, and nothing after it says anything is on ESPN (S12).
export type Rehearsal = { effectiveDay: number; lineupWriteId: string };

type Facts = { teamWeek: TeamWeekRead; rules: LeagueRulesRead };
export type MatchupNow = { matchup: AdjustmentWrite["matchup"]; day: number };
// How a run reads its matchup's sides, before the send and for the readback: from ESPN's current
// week, or by the matchup's id once its week has ended.
export type MatchupReader = () => Promise<MatchupNow | "not_current" | null>;
type Run = { rehearsal: Rehearsal | null; readNow: MatchupReader };
type Owed = Run & { finalTenths: number; lines: AdjustmentLine[] };
type Planned = Owed & { targetTenths: number; reason: string; now: MatchupNow };

// Once ESPN shows the lineup edit: the adjustment worked out from ESPN's day lines and the
// effective day, held while the league's rules differ or for re-approval of a changed amount,
// completed with nothing written when none is owed, or written as the side's current adjustment
// plus this request's amount, with its entry added to the side's reason, and read back (X11, X12,
// X17, A14, A21, S4). Unsettled while ESPN can't be read. A rehearsal runs the same checks from
// its assumed effective day and completes with the body recorded, not sent. Once ESPN's week is
// past the request's, only a re-approved amount is written (X26).
export async function runAdjustmentStep(
  context: WriteStepContext,
  request: SubRequestRecord,
  rehearsal: Rehearsal | null = null
): Promise<AdjustmentStepOutcome> {
  // A20: the starter came in through an earlier request this week, whose credit to him the
  // amount would have to forfeit. The app can't work that out yet (plan Revision 28), so the
  // commissioner settles it; the lineup stays as it is.
  const earlier = await findEarlierCreditingRequest(context.connection.db, request);
  if (earlier !== null) {
    const found = { detail: "chained_credit", earlierRequestId: earlier.requestId };
    return review(context, request, "adjustment_failed", found, "held");
  }
  const facts = await readFacts(context, request);
  if (facts === null) return { kind: "unsettled" };
  if (facts.teamWeek.week.matchupPeriodId !== request.matchupPeriodId) {
    return writeAfterItsWeek(context, request, facts.rules);
  }
  const effectiveDay = rehearsal?.effectiveDay ?? request.effectiveDay;
  const computed = computeFor(request, facts.teamWeek, effectiveDay);
  if (!computed.ok) {
    return review(context, request, "adjustment_failed", { detail: computed.reason }, "held");
  }
  const amount = { computedTenths: computed.totalTenths, lines: computed.lines };
  const readNow = () => readMatchup(context, request);
  return decideAndWrite(context, request, facts.rules, amount, { rehearsal, readNow });
}

// The rules check and the approval comparison on the amount, then nothing written when none is
// owed, or the write.
function decideAndWrite(
  context: WriteStepContext,
  request: SubRequestRecord,
  rules: LeagueRulesRead,
  amount: { computedTenths: number; lines: AdjustmentLine[] },
  run: Run
): Promise<AdjustmentStepOutcome> {
  const decision = decideAdjustment({
    rulesMatch: rules.mismatches.length === 0,
    computedTenths: amount.computedTenths,
    approvedComputedTenths: request.approvedComputedTenths,
    overrideTenths: request.overrideAdjustmentTenths,
  });
  if (decision.kind === "held") return hold(context, request, decision, rules);
  if (decision.kind === "none") {
    const found = { adjustment: "not_owed", ...amount, ...rehearsalRecord(run.rehearsal) };
    return complete(context, request, { finalTenths: 0, state: "not_owed", found }, null);
  }
  const { finalTenths } = decision;
  return writeAdjustment(context, request, { ...run, finalTenths, lines: amount.lines });
}

// ESPN's week is past the request's, so its day lines can't be read and nothing is recomputed.
// An amount the commissioner re-approved after this lineup's readback was computed at the hold
// from complete days, so it is written as approved, to that matchup's own side (X26, AC4-2).
// Any other request's adjustment stays with the commissioner.
async function writeAfterItsWeek(
  context: WriteStepContext,
  request: SubRequestRecord,
  rules: LeagueRulesRead
): Promise<AdjustmentStepOutcome> {
  const computedTenths = await reapprovedAmountOf(context, request);
  if (computedTenths === null) {
    return review(context, request, "adjustment_failed", { detail: "week_moved_on" }, "held");
  }
  const readNow = () => readPastMatchup(context, request);
  const run = { rehearsal: null, readNow };
  return decideAndWrite(context, request, rules, { computedTenths, lines: [] }, run);
}

const approvalSchema = z.object({
  computedTenths: z.number().int(),
  lineupState: z.string(),
  effectiveDay: z.number().int().nullable(),
});

// The amount of the request's latest approval, when that was a re-approval recorded with the
// lineup verified at the effective day the request still has. A first approval's amount is a
// projection for the day it was made, so it never counts here.
async function reapprovedAmountOf(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<number | null> {
  const detail = await getRequestDetail(context.connection.db, request.requestId);
  const latest = detail?.events.findLast(
    ({ eventType }) => eventType === "approved" || eventType === "reapproved"
  );
  const approval = approvalSchema.safeParse(latest?.payload);
  if (latest?.eventType !== "reapproved" || !approval.success) return null;
  const { computedTenths, lineupState, effectiveDay } = approval.data;
  const afterReadback = lineupState === "verified" && effectiveDay === request.effectiveDay;
  return afterReadback && computedTenths === request.approvedComputedTenths ? computedTenths : null;
}

// What a rehearsal's record carries in place of anything read back from ESPN.
function rehearsalRecord(rehearsal: Rehearsal | null): Record<string, unknown> {
  if (rehearsal === null) return {};
  const { effectiveDay, lineupWriteId } = rehearsal;
  return { rehearsal: true, assumedEffectiveDay: effectiveDay, lineupWriteId };
}

// The team's week (its day lines) and the league's rules, the two reads the amount rests on.
async function readFacts(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<Facts | null> {
  const read = await readEspn(context, async () => {
    const teamWeek = await context.espn.getTeamWeek(request.teamId);
    const rules = await context.espn.checkLeagueRules();
    return { teamWeek, rules };
  });
  return "code" in read ? null : read.value;
}

// Chained credits from an earlier request (Dec-D13) aren't gathered yet, as at Confirm.
function computeFor(
  request: SubRequestRecord,
  read: TeamWeekRead,
  effectiveDay: number | null
): AdjustmentResult {
  return computeAdjustment({
    matchupDays: [...read.week.scoringPeriodIds],
    requestDay: request.requestDay,
    effectiveDay,
    injured: {
      playerId: request.injuredPlayerId,
      creditedDays: playerDayPoints(read.days, request.injuredPlayerId, true),
      earlierCredits: [],
    },
    replacement: {
      playerId: request.replacementPlayerId,
      days: playerDayPoints(read.days, request.replacementPlayerId, false),
      tenthsAtRequest: request.replacementPointsAtRequestTenths ?? 0,
    },
  });
}

function hold(
  context: WriteStepContext,
  request: SubRequestRecord,
  decision: Extract<AdjustmentDecision, { kind: "held" }>,
  rules: LeagueRulesRead
): Promise<ReviewOutcome> {
  if (decision.reason === "adjustment_held_rules") {
    const found = { computedTenths: decision.computedTenths, mismatches: rules.mismatches };
    return review(context, request, decision.reason, found, "held");
  }
  const { computedTenths, approvedComputedTenths, overrideTenths } = decision;
  const found = { computedTenths, approvedComputedTenths, overrideTenths };
  return review(context, request, decision.reason, found, "held");
}

// The side read just before the send (the opponent's side goes back as read then, A16), its
// target and reason worked out, then sent, read back and settled.
async function writeAdjustment(
  context: WriteStepContext,
  request: SubRequestRecord,
  owed: Owed
): Promise<AdjustmentStepOutcome> {
  const { finalTenths } = owed;
  const now = await owed.readNow();
  if (now === null) return { kind: "unsettled" };
  if (now === "not_current") {
    return review(context, request, "adjustment_failed", { detail: "week_moved_on" }, "held");
  }
  const side = sideOf(now.matchup, request.teamId);
  // A side that already names this request is never added to: an earlier write of it landed
  // after its readback, or the commissioner entered it by hand (S2).
  if (findRequestEntry(side.adjustmentReason ?? "", request) !== null) {
    const found = { detail: "adjustment_unclear", finalTenths };
    return review(context, request, "ambiguous", found, "failed");
  }
  const targetTenths = targetSideAdjustment(toTenths(side.adjustment), finalTenths);
  const entry = adjustmentReasonEntry(request, finalTenths);
  const composed = composeReason(side.adjustmentReason ?? "", entry, ADJUSTMENT_REASON_MAX_LENGTH);
  if (!composed.ok) {
    const found = { detail: "reason_too_long", finalTenths };
    return review(context, request, "adjustment_failed", found, "held");
  }
  return sendAndSettle(context, request, { ...owed, targetTenths, reason: composed.reason, now });
}

async function sendAndSettle(
  context: WriteStepContext,
  request: SubRequestRecord,
  planned: Planned
): Promise<AdjustmentStepOutcome> {
  const payload = { targetTenths: planned.targetTenths, finalTenths: planned.finalTenths };
  const answer = { patch: { adjustmentState: "sent" as const }, payload };
  const sent = await sendAndReadBack(context, request, planned, answer);
  if (sent.kind === "gate_closed") return review(context, request, sent.gate, {}, undefined);
  if (sent.kind === "recorded_only") return settleUnsent(context, request, planned, sent.writeId);
  if (sent.kind !== "read") return sent;
  return settle(context, sent, planned);
}

// The body was recorded, not sent. That completes a rehearsal, nothing being on ESPN (S12); with
// the lineup really on ESPN the adjustment is still owed, so it goes to the commissioner (X25).
async function settleUnsent(
  context: WriteStepContext,
  request: SubRequestRecord,
  planned: Planned,
  writeId: string
): Promise<AdjustmentStepOutcome> {
  await recordNotSent(context, writeId);
  const { finalTenths, targetTenths, lines, rehearsal } = planned;
  if (rehearsal === null) {
    const found = { detail: "not_sent", writeId, finalTenths };
    return review(context, request, "adjustment_failed", found, "held");
  }
  const amounts = { finalTenths, targetTenths, lines };
  const found = { ...rehearsalRecord(rehearsal), adjustmentWriteId: writeId, ...amounts };
  return complete(context, request, { finalTenths, state: "pending", found }, null);
}

// One adjustment write: the matchup as read just before it (the opponent's side goes back as read
// then, A16), the team's side's target and reason, and how to read the side back.
export type AdjustmentSend = {
  now: MatchupNow;
  targetTenths: number;
  reason: string;
  readNow: MatchupReader;
};

// What ESPN's answer writes on the request: its patch and its event's payload.
export type AdjustmentAnswer = { patch: RequestPatch; payload: Record<string, unknown> };

export type AdjustmentSendOutcome =
  | { kind: "gate_closed"; gate: Exclude<WriteGate, "open"> }
  | { kind: "lost" }
  | { kind: "recorded_only"; writeId: string }
  | { kind: "unsettled" }
  | {
      kind: "read";
      request: SubRequestRecord;
      writeId: string;
      failureCode: AdjustmentFailure;
      verified: boolean;
      read: MatchupNow;
    };

// The allowlist read again, the write sent behind its attempt row, ESPN's answer recorded with the
// caller's patch and payload, then the side read back until it shows the write or the rounds run
// out, the attempt keeping what was read. Nothing else moves the request: each caller settles the
// outcome its own way (this step, and the proving run's token and revert).
export async function sendAndReadBack(
  context: WriteStepContext,
  request: SubRequestRecord,
  planned: AdjustmentSend,
  answer: AdjustmentAnswer
): Promise<AdjustmentSendOutcome> {
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") return { kind: "gate_closed", gate };
  const sent = await sendAdjustment(context, request, planned, new Set(settings.writeAllowlist));
  if (sent.kind !== "answered") return sent;
  const change = { ...answer, eventType: "adjustment_sent" as const };
  const answered = await recordAnswer(context, request, sent, change);
  if (answered === null) return { kind: "lost" };
  return readBackSide(context, answered, sent, planned);
}

function sendAdjustment(
  context: WriteStepContext,
  request: SubRequestRecord,
  planned: AdjustmentSend,
  allowlist: ReadonlySet<number>
): Promise<SendResult> {
  const { teamId, matchupId } = request;
  const { matchup, day } = planned.now;
  const write = { matchup, teamId, targetTenths: planned.targetTenths, reason: planned.reason };
  const attempt = {
    requestId: request.requestId,
    kind: "adjustment" as const,
    teamId,
    matchupId,
    scoringPeriodId: day,
  };
  return sendWrite(context, attempt, allowlist, (client, guard) =>
    client.applyAdjustment(write, guard)
  );
}

// What ESPN shows of the side after the write: the target and the reason, or not; unsettled while
// ESPN can't be read.
async function readBackSide(
  context: WriteStepContext,
  request: SubRequestRecord,
  sent: { writeId: string; failureCode: AdjustmentFailure },
  planned: AdjustmentSend
): Promise<AdjustmentSendOutcome> {
  const shows = (now: MatchupNow) => {
    const side = sideOf(now.matchup, request.teamId);
    const reason = side.adjustmentReason ?? "";
    return toTenths(side.adjustment) === planned.targetTenths && reason === planned.reason;
  };
  const readOnce = async () => {
    const now = await planned.readNow();
    return now === "not_current" ? null : now;
  };
  const read = await pollReadback(context, sent.failureCode, readOnce, shows);
  if (read === null) return { kind: "unsettled" };
  const verified = shows(read);
  const readback = sideOf(read.matchup, request.teamId);
  const outcome = verified ? "verified" : "not_applied";
  await recordWriteReadback(context.connection.db, sent.writeId, { outcome, readback });
  const { writeId, failureCode } = sent;
  return { kind: "read", request, writeId, failureCode, verified, read };
}

// What the readback settles: completed with the target and reason on ESPN, or adjustment_failed
// with the lineup done (X16), or back in line after an answer that left the write open (O6).
async function settle(
  context: WriteStepContext,
  sent: Extract<AdjustmentSendOutcome, { kind: "read" }>,
  planned: Planned
): Promise<AdjustmentStepOutcome> {
  const { request, writeId, failureCode, verified } = sent;
  if (!verified && mayRunAgain(failureCode)) {
    const found = { writeId, failureCode };
    return putBackInLine(context, request, { lineupState: "verified", found, at: context.clock() });
  }
  if (!verified) {
    const found = { writeId, failureCode };
    return review(context, request, "adjustment_failed", found, "failed");
  }
  const found = { writeId, finalTenths: planned.finalTenths };
  const completion = { finalTenths: planned.finalTenths, state: "verified" as const, found };
  return complete(context, request, completion, sent.read);
}

type AdjustmentFailure = Parameters<typeof pollReadback>[1];

// The request's matchup as ESPN shows it now, with ESPN's day; not_current once ESPN's week is
// another one; null while ESPN can't be read.
export async function readMatchup(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<MatchupNow | "not_current" | null> {
  const read = await readEspn(context, () => context.espn.getCurrentWeek());
  if ("code" in read) return null;
  const { meta, week } = read.value;
  const matchup = week.matchups.find((each) => each.matchupId === request.matchupId);
  return matchup === undefined ? "not_current" : { matchup, day: meta.scoringPeriodId };
}

// The request's matchup by its id, whatever ESPN's week is now; null while ESPN can't be read.
async function readPastMatchup(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<MatchupNow | null> {
  const read = await readEspn(context, () => context.espn.getMatchup(request.matchupId));
  if ("code" in read) return null;
  const { meta, matchup } = read.value;
  return { matchup, day: meta.scoringPeriodId };
}

export function sideOf(matchup: MatchupNow["matchup"], teamId: number): SideAdjustment {
  const side = [matchup.home, matchup.away].find((each) => each?.teamId === teamId);
  if (side === undefined || side === null) {
    throw new RangeError(`team ${teamId} isn't in matchup ${matchup.matchupId}`);
  }
  return side;
}

// Completed, with the adjustment's state and amount; an adjustment ESPN confirmed also keeps the
// matchup as read back and its own event, a moment before the completion's. A rehearsal's stays
// pending: its body was recorded, never sent.
export async function complete(
  context: WriteStepContext,
  request: SubRequestRecord,
  completion: {
    finalTenths: number;
    state: "verified" | "not_owed" | "pending";
    found: Record<string, unknown>;
  },
  readBack: MatchupNow | null
): Promise<AdjustmentStepOutcome> {
  const next = executorTransition(request, { type: "complete" });
  if (!next.ok) return { kind: "lost" };
  const verifiedAt = context.clock();
  const completedAt = context.clock();
  const row = await context.connection.transaction(async (tx) => {
    const moved = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: {
        status: next.status,
        adjustmentState: completion.state,
        finalAdjustmentTenths: completion.finalTenths,
      },
      now: completedAt,
    });
    if (moved === null) return null;
    if (readBack !== null) await recordVerified(tx, moved, completion.found, readBack, verifiedAt);
    await appendEvent(tx, moved.requestId, systemEvent("completed", completion.found, completedAt));
    return moved;
  });
  return row === null
    ? { kind: "lost" }
    : { kind: "completed", request: row, finalTenths: completion.finalTenths };
}

async function recordVerified(
  tx: DatabaseExecutor,
  request: SubRequestRecord,
  found: Record<string, unknown>,
  readBack: MatchupNow,
  at: Date
): Promise<void> {
  await insertSnapshot(tx, request.requestId, "adjustment_verified", {
    snapshotId: randomUUID(),
    espnDay: readBack.day,
    takenAt: at,
    payload: { matchup: readBack.matchup },
  });
  await appendEvent(tx, request.requestId, systemEvent("adjustment_verified", found, at));
}

function review(
  context: WriteStepContext,
  request: SubRequestRecord,
  reason: ReviewReason,
  found: Record<string, unknown>,
  adjustmentState: "held" | "failed" | undefined
): Promise<ReviewOutcome> {
  const patch = adjustmentState === undefined ? {} : { adjustmentState };
  return moveToReview(context, request, { reason, found, patch, at: context.clock() });
}
