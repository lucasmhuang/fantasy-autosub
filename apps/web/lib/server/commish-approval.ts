import { loadServerEnv } from "@injurysub/config";
import type { RequestDetail, RequestPatch, SubRequestRecord } from "@injurysub/db";
import { computeAdjustment, playerDayPoints } from "@injurysub/domain";
import type { TeamWeekRead } from "@injurysub/espn";
import { z } from "zod";
import type { Change, CommissionerActionResult } from "./commish-actions";

const HOUR_MS = 3_600_000;
const WHOLE_TENTHS = /^-?\d+$/;
// The executor's hold keeps the amount it computed on its event.
const heldSchema = z.object({ computedTenths: z.number().int() });

type Approver = { form: FormData; now: Date; actorTeamId: number | null };

// The adjustment from ESPN's day lines now, for the effective day given (null: the swap never
// took effect). Chained credits from an earlier request aren't gathered (A20).
export function recomputed(
  read: TeamWeekRead,
  request: SubRequestRecord,
  effectiveDay: number | null
) {
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

// The amount an approval approves: the adjustment if the lineup edit took effect on ESPN's day
// now, since an approvable request's lineup is still to do. Null when it can't be worked out.
export function amountToApprove(read: TeamWeekRead, request: SubRequestRecord): number | null {
  const computed = recomputed(read, request, read.week.todayScoringPeriodId);
  return computed.ok ? computed.totalTenths : null;
}

// The amount the executor held for re-approval, from the request's latest hold.
export function heldAmountOf(events: RequestDetail["events"]): number | null {
  const hold = events.findLast((event) => event.eventType === "sent_to_review");
  const held = heldSchema.safeParse(hold?.payload);
  return held.success ? held.data.computedTenths : null;
}

// Q6, Q18: approves the amount computed at this moment, which must be the one the page showed.
export function approval(
  approver: Approver,
  request: SubRequestRecord,
  read: TeamWeekRead
): Change | CommissionerActionResult {
  const shown = approver.form.get("shownTenths");
  if (typeof shown !== "string" || !WHOLE_TENTHS.test(shown)) return { status: "invalid_form" };
  const computedTenths = amountToApprove(read, request);
  if (computedTenths === null) return { status: "not_allowed" };
  if (Number(shown) !== computedTenths) return { status: "amount_changed" };
  return approvalChange("approved", approver, request, computedTenths, {});
}

// Q6: approves the amount the executor held, which the page's version pins.
export function reapproval(
  approver: Approver,
  request: SubRequestRecord,
  events: RequestDetail["events"]
): Change | CommissionerActionResult {
  const computedTenths = heldAmountOf(events);
  if (computedTenths === null) return { status: "not_allowed" };
  const patch = { adjustmentState: "pending" as const };
  return approvalChange("reapproved", approver, request, computedTenths, patch);
}

// The wait for execution starts again at the approval (AC2-1). The event keeps the lineup's state
// and effective day as they stood, which tell a re-approval of an amount computed after the
// lineup's readback from a first approval's projection (AC4-2).
function approvalChange(
  eventType: "approved" | "reapproved",
  approver: Approver,
  request: SubRequestRecord,
  computedTenths: number,
  patch: RequestPatch
): Change {
  const waitMs = loadServerEnv().REQUEST_EXPIRY_HOURS * HOUR_MS;
  const expiresAt = new Date(approver.now.getTime() + waitMs);
  return {
    patch: { ...patch, approvedComputedTenths: computedTenths, expiresAt },
    eventType,
    payload: {
      computedTenths,
      overrideTenths: request.overrideAdjustmentTenths,
      expiresAt: expiresAt.toISOString(),
      selfApproval: approver.actorTeamId === request.teamId,
      lineupState: request.lineupState,
      effectiveDay: request.effectiveDay,
    },
    snapshot: null,
    done: eventType,
  };
}
