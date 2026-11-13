import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  insertSnapshot,
  readLeagueSettings,
  recordWriteReadback,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import {
  ADJUSTMENT_REASON_MAX_LENGTH,
  type AdjustmentDecision,
  type AdjustmentResult,
  adjustmentReasonEntry,
  composeReason,
  computeAdjustment,
  decideAdjustment,
  executorTransition,
  playerDayPoints,
  type ReviewReason,
  targetSideAdjustment,
  toTenths,
  writeGateFor,
} from "@injurysub/domain";
import {
  EspnError,
  type LeagueRulesRead,
  type Matchup,
  type MatchupSide,
  type TeamWeekRead,
} from "@injurysub/espn";
import { systemEvent } from "./claim";
import {
  pollReadback,
  recordAnswer,
  recordNotSent,
  type SendResult,
  sendWrite,
} from "./espn-write";
import type { WriteStepContext } from "./preflight";
import { moveToReview, type ReviewOutcome } from "./review";

export type AdjustmentStepOutcome =
  | { kind: "completed"; request: SubRequestRecord; finalTenths: number }
  | ReviewOutcome
  | { kind: "unsettled" }
  | { kind: "recorded_only" };

type Facts = { teamWeek: TeamWeekRead; rules: LeagueRulesRead };
type MatchupNow = { matchup: Matchup; day: number };
type Planned = { finalTenths: number; targetTenths: number; reason: string; now: MatchupNow };

// Once ESPN shows the lineup edit: the adjustment worked out from ESPN's day lines and the
// effective day, held while the league's rules differ or for re-approval of a changed amount,
// completed with nothing written when none is owed, or written as the side's current adjustment
// plus this request's amount, with its entry added to the side's reason, and read back (X11, X12,
// X17, A14, A21, S4). Unsettled while ESPN can't be read.
export async function runAdjustmentStep(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<AdjustmentStepOutcome> {
  const facts = await readFacts(context, request);
  if (facts === null) return { kind: "unsettled" };
  if (facts.teamWeek.week.matchupPeriodId !== request.matchupPeriodId) {
    return review(context, request, "adjustment_failed", { detail: "week_moved_on" }, "held");
  }
  const computed = computeFor(request, facts.teamWeek);
  if (!computed.ok) {
    return review(context, request, "adjustment_failed", { detail: computed.reason }, "held");
  }
  const decision = decideAdjustment({
    rulesMatch: facts.rules.mismatches.length === 0,
    computedTenths: computed.totalTenths,
    approvedComputedTenths: request.approvedComputedTenths,
    overrideTenths: request.overrideAdjustmentTenths,
  });
  if (decision.kind === "held") return hold(context, request, decision, facts.rules);
  if (decision.kind === "none") {
    const found = { adjustment: "not_owed", computedTenths: 0, lines: computed.lines };
    return complete(context, request, { finalTenths: 0, state: "not_owed", found }, null);
  }
  return writeAdjustment(context, request, decision.finalTenths);
}

// The team's week (its day lines) and the league's rules, the two reads the amount rests on.
async function readFacts(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<Facts | null> {
  try {
    const teamWeek = await context.espn.getTeamWeek(request.teamId);
    const rules = await context.espn.checkLeagueRules();
    return { teamWeek, rules };
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    const fields = { requestId: request.requestId, code: error.code };
    context.logger.warn("worker.executor.adjustment_unread", fields);
    return null;
  }
}

// Chained credits from an earlier request (Dec-D13) aren't gathered yet, as at Confirm.
function computeFor(request: SubRequestRecord, read: TeamWeekRead): AdjustmentResult {
  return computeAdjustment({
    matchupDays: [...read.week.scoringPeriodIds],
    requestDay: request.requestDay,
    effectiveDay: request.effectiveDay,
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
  finalTenths: number
): Promise<AdjustmentStepOutcome> {
  const now = await readMatchup(context, request);
  if (now === null) return { kind: "unsettled" };
  if (now === "not_current") {
    return review(context, request, "adjustment_failed", { detail: "week_moved_on" }, "held");
  }
  const side = sideOf(now.matchup, request.teamId);
  const targetTenths = targetSideAdjustment(toTenths(side.adjustment), finalTenths);
  const entry = adjustmentReasonEntry(request, finalTenths);
  const composed = composeReason(side.adjustmentReason ?? "", entry, ADJUSTMENT_REASON_MAX_LENGTH);
  if (!composed.ok) {
    const found = { detail: "reason_too_long", finalTenths };
    return review(context, request, "adjustment_failed", found, "held");
  }
  return sendAndSettle(context, request, {
    finalTenths,
    targetTenths,
    reason: composed.reason,
    now,
  });
}

async function sendAndSettle(
  context: WriteStepContext,
  request: SubRequestRecord,
  planned: Planned
): Promise<AdjustmentStepOutcome> {
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") return review(context, request, gate, {}, undefined);
  const sent = await sendAdjustment(context, request, planned, new Set(settings.writeAllowlist));
  if (sent.kind === "lost") return { kind: "lost" };
  if (sent.kind === "recorded_only") {
    await recordNotSent(context, sent.writeId);
    return { kind: "recorded_only" };
  }
  const payload = { targetTenths: planned.targetTenths, finalTenths: planned.finalTenths };
  const change = {
    patch: { adjustmentState: "sent" as const },
    eventType: "adjustment_sent" as const,
    payload,
  };
  const answered = await recordAnswer(context, request, sent, change);
  if (answered === null) return { kind: "lost" };
  return settle(context, answered, sent, planned);
}

function sendAdjustment(
  context: WriteStepContext,
  request: SubRequestRecord,
  planned: Planned,
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

// What ESPN shows of the side after the write decides it: the target and the reason, or
// adjustment_failed with the lineup done (X16); unsettled while ESPN can't be read.
async function settle(
  context: WriteStepContext,
  request: SubRequestRecord,
  sent: { writeId: string; failureCode: AdjustmentFailure },
  planned: Planned
): Promise<AdjustmentStepOutcome> {
  const shows = (now: MatchupNow) => {
    const side = sideOf(now.matchup, request.teamId);
    const reason = side.adjustmentReason ?? "";
    return toTenths(side.adjustment) === planned.targetTenths && reason === planned.reason;
  };
  const readOnce = async () => {
    const now = await readMatchup(context, request);
    return now === "not_current" ? null : now;
  };
  const read = await pollReadback(context, sent.failureCode, readOnce, shows);
  if (read === null) return { kind: "unsettled" };
  const verified = shows(read);
  const readback = sideOf(read.matchup, request.teamId);
  const outcome = verified ? "verified" : "not_applied";
  await recordWriteReadback(context.connection.db, sent.writeId, { outcome, readback });
  if (!verified) {
    const found = { writeId: sent.writeId, failureCode: sent.failureCode };
    return review(context, request, "adjustment_failed", found, "failed");
  }
  const found = { writeId: sent.writeId, finalTenths: planned.finalTenths };
  const completion = { finalTenths: planned.finalTenths, state: "verified" as const, found };
  return complete(context, request, completion, read);
}

type AdjustmentFailure = Parameters<typeof pollReadback>[1];

// The request's matchup as ESPN shows it now, with ESPN's day; not_current once ESPN's week is
// another one; null while ESPN can't be read.
async function readMatchup(
  context: WriteStepContext,
  request: SubRequestRecord
): Promise<MatchupNow | "not_current" | null> {
  try {
    const { meta, week } = await context.espn.getCurrentWeek();
    const matchup = week.matchups.find((each) => each.matchupId === request.matchupId);
    return matchup === undefined ? "not_current" : { matchup, day: meta.scoringPeriodId };
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    const fields = { requestId: request.requestId, code: error.code };
    context.logger.warn("worker.executor.adjustment_unread", fields);
    return null;
  }
}

function sideOf(matchup: Matchup, teamId: number): MatchupSide {
  const side = [matchup.home, matchup.away].find((each) => each?.teamId === teamId);
  if (side === undefined || side === null) {
    throw new RangeError(`team ${teamId} isn't in matchup ${matchup.matchupId}`);
  }
  return side;
}

// Completed, with the adjustment's state and amount; an adjustment ESPN confirmed also keeps the
// matchup as read back and its own event, a moment before the completion's.
async function complete(
  context: WriteStepContext,
  request: SubRequestRecord,
  completion: {
    finalTenths: number;
    state: "verified" | "not_owed";
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
