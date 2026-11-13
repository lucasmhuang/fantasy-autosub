import {
  findOldestExecutingRequest,
  getRequestDetail,
  listWriteAttempts,
  recordWriteReadback,
  type SubRequestRecord,
  type WriteAttemptRecord,
} from "@injurysub/db";
import { amountInReasonEntry, readBackLineupEdit, sentEditOf, toTenths } from "@injurysub/domain";
import { z } from "zod";
import {
  type AdjustmentStepOutcome,
  complete,
  type MatchupNow,
  readMatchup,
  runAdjustmentStep,
  sideOf,
} from "./adjustment-step";
import { mayRunAgain } from "./espn-write";
import { type LineupStepOutcome, readDays, settleLineup } from "./lineup-step";
import { readEspn, type WriteStepContext } from "./preflight";
import { moveToReview, putBackInLine } from "./review";

export type RecoveryOutcome = LineupStepOutcome | AdjustmentStepOutcome;

// Settles a request a pass left executing: stopped by a restart or a deploy, its lease lost, or
// its readback unread while ESPN was down (X20, S2, O6). Under the lease no pass is running, so
// every executing request is one of those. ESPN is read first and nothing is sent again without
// a readback: a write ESPN shows is taken as done and the run goes on from there; one it doesn't
// show runs again only when its answer left that open; anything unclear goes to the commissioner.
// One request a pass; null when none is left.
export async function recoverInterrupted(
  context: WriteStepContext
): Promise<RecoveryOutcome | null> {
  const request = await findOldestExecutingRequest(context.connection.db);
  if (request === null) return null;
  const attempts = await listWriteAttempts(context.connection.db, request.requestId);
  const lastSent = (kind: WriteAttemptRecord["kind"]) =>
    attempts.findLast((each) => each.kind === kind && each.status !== "recorded_only") ?? null;
  if (request.lineupState === "verified") {
    return recoverAdjustment(context, request, lastSent("adjustment"));
  }
  const lineup = lastSent("lineup");
  if (lineup === null) {
    const back = {
      lineupState: "pending" as const,
      found: { recovered: "nothing_sent" },
      at: context.clock(),
    };
    return putBackInLine(context, request, back);
  }
  return recoverLineup(context, request, lineup);
}

// An attempt's answer as the steps read it: none for an answered write, ESPN's code for a failed
// one, and an unknown outcome for one that never got an answer recorded.
function answerOf(attempt: WriteAttemptRecord): string | null {
  if (attempt.status === "answered") return null;
  return attempt.failureCode ?? "outcome_unknown";
}

async function recoverLineup(
  context: WriteStepContext,
  request: SubRequestRecord,
  attempt: WriteAttemptRecord
): Promise<RecoveryOutcome> {
  const items = await sentItemsOf(context, request);
  const read = await readEspn(context, () => context.espn.getCurrentWeek());
  if ("code" in read) return { kind: "unsettled" };
  const { week } = read.value;
  const first = attempt.scoringPeriodId;
  if (items === null || first === null || week.matchupPeriodId !== request.matchupPeriodId) {
    const found = { writeId: attempt.writeId, detail: "readback_unavailable" };
    const at = context.clock();
    return moveToReview(context, request, {
      reason: "ambiguous",
      found,
      patch: { lineupState: "ambiguous" },
      at,
    });
  }
  const days = await readDays(context, request.teamId, first, Math.max(...week.scoringPeriodIds));
  if (days === null) return { kind: "unsettled" };
  const readback = { readback: readBackLineupEdit({ items, days }), days };
  const sent = { writeId: attempt.writeId, failureCode: answerOf(attempt) };
  const settled = await settleLineup(context, request, sent, readback);
  return settled.kind === "lineup_verified" ? runAdjustmentStep(context, settled.request) : settled;
}

// The edit the request's latest claim sent.
async function sentItemsOf(context: WriteStepContext, request: SubRequestRecord) {
  const detail = await getRequestDetail(context.connection.db, request.requestId);
  const claimed = detail?.events.findLast((event) => event.eventType === "claimed");
  return sentEditOf(claimed?.payload)?.items ?? null;
}

const sideBodySchema = z.object({
  teamId: z.number(),
  adjustment: z.number(),
  adjustmentReason: z.string(),
});
const scheduleBodySchema = z.tuple([z.object({ home: sideBodySchema, away: sideBodySchema })]);

// What an adjustment attempt set the team's side to: its target and reason, from the body sent.
function plannedOf(attempt: WriteAttemptRecord, teamId: number) {
  const parsed = scheduleBodySchema.safeParse(attempt.body);
  if (!parsed.success) return null;
  const [matchup] = parsed.data;
  const side = [matchup.home, matchup.away].find((each) => each.teamId === teamId);
  if (side === undefined) return null;
  const entry = side.adjustmentReason.split(" | ").at(-1) ?? "";
  return {
    targetTenths: toTenths(side.adjustment),
    reason: side.adjustmentReason,
    entry,
    finalTenths: amountInReasonEntry(entry),
  };
}

async function recoverAdjustment(
  context: WriteStepContext,
  request: SubRequestRecord,
  attempt: WriteAttemptRecord | null
): Promise<RecoveryOutcome> {
  if (attempt === null) return runAdjustmentStep(context, request);
  const planned = plannedOf(attempt, request.teamId);
  const now = await readMatchup(context, request);
  if (now === null) return { kind: "unsettled" };
  if (now === "not_current" || planned === null)
    return unclearAdjustment(context, request, attempt);
  const side = sideOf(now.matchup, request.teamId);
  const reason = side.adjustmentReason ?? "";
  if (toTenths(side.adjustment) === planned.targetTenths && reason === planned.reason) {
    return completeRecovered(context, request, attempt, now, planned.finalTenths);
  }
  // This request's entry on the side means the write landed and the side changed since.
  if (reason.split(" | ").includes(planned.entry))
    return unclearAdjustment(context, request, attempt);
  await recordWriteReadback(context.connection.db, attempt.writeId, {
    outcome: "not_applied",
    readback: side,
  });
  if (mayRunAgain(answerOf(attempt))) return runAdjustmentStep(context, request);
  const found = { writeId: attempt.writeId, failureCode: answerOf(attempt) };
  const at = context.clock();
  return moveToReview(context, request, {
    reason: "adjustment_failed",
    found,
    patch: { adjustmentState: "failed" },
    at,
  });
}

async function completeRecovered(
  context: WriteStepContext,
  request: SubRequestRecord,
  attempt: WriteAttemptRecord,
  now: MatchupNow,
  finalTenths: number | null
): Promise<RecoveryOutcome> {
  if (finalTenths === null) return unclearAdjustment(context, request, attempt);
  const readback = sideOf(now.matchup, request.teamId);
  await recordWriteReadback(context.connection.db, attempt.writeId, {
    outcome: "verified",
    readback,
  });
  const found = { writeId: attempt.writeId, finalTenths, recovered: true };
  return complete(context, request, { finalTenths, state: "verified", found }, now);
}

function unclearAdjustment(
  context: WriteStepContext,
  request: SubRequestRecord,
  attempt: WriteAttemptRecord
): Promise<RecoveryOutcome> {
  const found = { writeId: attempt.writeId, detail: "adjustment_unclear" };
  const at = context.clock();
  return moveToReview(context, request, {
    reason: "ambiguous",
    found,
    patch: { adjustmentState: "failed" },
    at,
  });
}
