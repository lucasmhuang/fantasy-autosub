import { randomUUID } from "node:crypto";
import {
  appendEvent,
  describeFailure,
  getRequestDetail,
  insertSnapshot,
  isDatabaseQueryError,
  type NewSubRequestEvent,
  type NewSubRequestSnapshot,
  type RequestPatch,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import {
  type AdjustmentResult,
  computeAdjustment,
  playerDayPoints,
  type RequestActionType,
  type RequestEventType,
  toTenths,
  transition,
} from "@injurysub/domain";
import type { TeamWeekRead } from "@injurysub/espn";
import { readTeamWeek } from "./board";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";
import { REQUEST_ID } from "./request-view";

export type CommissionerAction = "reject" | "override" | "complete" | "reverse";

export type CommissionerActionResult = {
  status:
    | "rejected"
    | "override_set"
    | "completed_manually"
    | "reversed"
    | "not_found"
    | "not_allowed"
    | "changed"
    | "invalid_form"
    | "espn_unreachable"
    | "week_moved_on"
    | "unavailable";
};

// What an action writes: the request's new fields, its event, and any snapshot.
type Change = {
  patch: RequestPatch;
  eventType: RequestEventType;
  payload: Record<string, unknown>;
  snapshot: NewSubRequestSnapshot | null;
  done: CommissionerActionResult["status"];
};

type ActionInput = {
  actorUserId: string;
  requestId: string;
  action: CommissionerAction;
  form: FormData;
  now: Date;
};

const DOMAIN_ACTIONS: Record<CommissionerAction, RequestActionType> = {
  reject: "reject",
  override: "override",
  complete: "complete_manually",
  reverse: "reverse",
};
const AMOUNT = /^-?\d{1,4}(\.\d)?$/;
// A completion recorded by hand says the commissioner made the change on ESPN, so a request that
// ran as a rehearsal before is one no longer.
const DONE_ON_ESPN = { isRehearsal: false };
const MAX_REASON_LENGTH = 500;

// The commissioner acts on a request at the version their page showed: of two actions at once,
// only the first takes effect, and a stale page is told the request changed (Q13). Every action
// is kept as an event with who and when (H6). Nothing here writes to ESPN.
export async function actOnRequest(input: ActionInput): Promise<CommissionerActionResult> {
  const shownVersion = input.form.get("version");
  const version =
    typeof shownVersion === "string" && /^\d+$/.test(shownVersion) ? Number(shownVersion) : NaN;
  if (!REQUEST_ID.test(input.requestId)) return { status: "not_found" };
  if (!Number.isSafeInteger(version)) return { status: "invalid_form" };
  try {
    const detail = await getRequestDetail(getWebDatabaseConnection().db, input.requestId);
    if (detail === null) return { status: "not_found" };
    const { request } = detail;
    if (request.version !== version) return { status: "changed" };
    const allowed = transition(
      request,
      { type: DOMAIN_ACTIONS[input.action] },
      { matchupEnded: false, writeGate: "open" }
    );
    if (!allowed.ok) return { status: "not_allowed" };
    const change = await changeFor(input, request);
    if ("status" in change) return change;
    // The status is the domain's (lifecycle.ts), whatever else the action writes.
    const patch = { ...change.patch, status: allowed.status, reviewReason: allowed.reviewReason };
    return await applyChange(input, request, { ...change, patch });
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.commish.database_failed", undefined, {
      flow: input.action,
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

async function changeFor(
  input: ActionInput,
  request: SubRequestRecord
): Promise<Change | CommissionerActionResult> {
  switch (input.action) {
    case "reject":
      return rejection(input.form);
    case "override":
      return overrideOf(input.form, request);
    case "complete":
      return manualCompletion(input, request);
    case "reverse":
      return reversal(request);
  }
}

// Q7: the manager sees the reason.
function rejection(form: FormData): Change | CommissionerActionResult {
  // A browser sends each line break as CRLF but counts it as one character against maxLength.
  const reason = String(form.get("reason") ?? "")
    .replaceAll("\r\n", "\n")
    .trim();
  if (reason === "" || reason.length > MAX_REASON_LENGTH) return { status: "invalid_form" };
  return {
    patch: {},
    eventType: "rejected",
    payload: { reason },
    snapshot: null,
    done: "rejected",
  };
}

// Q8: the override is the amount applied; the computed one stays beside it.
function overrideOf(form: FormData, request: SubRequestRecord): Change | CommissionerActionResult {
  const amount = String(form.get("amount") ?? "").trim();
  if (!AMOUNT.test(amount)) return { status: "invalid_form" };
  const overrideTenths = toTenths(Number(amount));
  return {
    patch: { overrideAdjustmentTenths: overrideTenths },
    eventType: "override_set",
    payload: { overrideTenths, computedTenths: request.projectedAdjustmentTenths },
    snapshot: null,
    done: "override_set",
  };
}

// Q10: the inverse of what was applied, shown for the commissioner to enter. A rehearsal wrote
// nothing to ESPN, so there is nothing to take back.
function reversal(request: SubRequestRecord): Change {
  const applied =
    request.finalAdjustmentTenths ??
    request.overrideAdjustmentTenths ??
    request.projectedAdjustmentTenths ??
    0;
  return {
    patch: {},
    eventType: "reversed",
    payload: { inverseTenths: request.isRehearsal ? 0 : -applied },
    snapshot: null,
    done: "reversed",
  };
}

// Q9, Q11: the adjustment recomputed for the effective day the commissioner gives, or, for an
// adjustment-only settlement, as if the swap never took effect (A2's null day), from ESPN's day
// lines now. An override, when set, is the amount applied.
async function manualCompletion(
  input: ActionInput,
  request: SubRequestRecord
): Promise<Change | CommissionerActionResult> {
  const adjustmentOnly = input.form.get("adjustmentOnly") === "1";
  const effectiveDay = adjustmentOnly ? null : Number(input.form.get("effectiveDay"));
  if (effectiveDay !== null && !Number.isSafeInteger(effectiveDay))
    return { status: "invalid_form" };
  const read = await readTeamWeek(request.teamId);
  if ("status" in read) return { status: "espn_unreachable" };
  if (read.week.matchupPeriodId !== request.matchupPeriodId) {
    return completionByOverride(request, effectiveDay, adjustmentOnly);
  }

  const computed = recomputed(read, request, effectiveDay);
  if (!computed.ok) return { status: "invalid_form" };
  const finalTenths = request.overrideAdjustmentTenths ?? computed.totalTenths;
  return {
    patch: { effectiveDay, finalAdjustmentTenths: finalTenths, ...DONE_ON_ESPN },
    eventType: "completed_manually",
    payload: {
      effectiveDay,
      adjustmentOnly,
      computedTenths: computed.totalTenths,
      overrideTenths: request.overrideAdjustmentTenths,
    },
    snapshot: completionSnapshot(read, input.now, computed),
    done: "completed_manually",
  };
}

// Once ESPN's week is past the request's matchup, the week read can't see its days, so nothing is
// recomputed: only an override settles it, against the amount computed when it was set.
function completionByOverride(
  request: SubRequestRecord,
  effectiveDay: number | null,
  adjustmentOnly: boolean
): Change | CommissionerActionResult {
  const override = request.overrideAdjustmentTenths;
  if (override === null) return { status: "week_moved_on" };
  if (effectiveDay !== null && effectiveDay < request.requestDay) return { status: "invalid_form" };
  return {
    patch: { effectiveDay, finalAdjustmentTenths: override, ...DONE_ON_ESPN },
    eventType: "completed_manually",
    payload: {
      effectiveDay,
      adjustmentOnly,
      computedTenths: request.projectedAdjustmentTenths,
      overrideTenths: override,
      recomputed: false,
    },
    snapshot: null,
    done: "completed_manually",
  };
}

// What ESPN showed when the commissioner recorded the completion, with the amount computed from it.
function completionSnapshot(
  read: TeamWeekRead,
  now: Date,
  computed: Extract<AdjustmentResult, { ok: true }>
): NewSubRequestSnapshot {
  return {
    snapshotId: randomUUID(),
    espnDay: read.week.todayScoringPeriodId,
    takenAt: now,
    payload: {
      meta: read.meta,
      lineup: read.lineup,
      matchup: read.matchup,
      days: read.days,
      computed: { totalTenths: computed.totalTenths, lines: computed.lines },
    },
  };
}

function recomputed(read: TeamWeekRead, request: SubRequestRecord, effectiveDay: number | null) {
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

async function applyChange(
  input: ActionInput,
  request: SubRequestRecord,
  change: Change
): Promise<CommissionerActionResult> {
  return getWebDatabaseConnection().transaction(async (tx) => {
    const moved = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: change.patch,
      now: input.now,
    });
    if (moved === null) return { status: "changed" };
    const event: NewSubRequestEvent = {
      eventId: randomUUID(),
      actorType: "commissioner",
      actorUserId: input.actorUserId,
      eventType: change.eventType,
      payload: change.payload,
      createdAt: input.now,
    };
    await appendEvent(tx, request.requestId, event);
    if (change.snapshot !== null) {
      await insertSnapshot(tx, request.requestId, "manual_completion", change.snapshot);
    }
    return { status: change.done };
  });
}
