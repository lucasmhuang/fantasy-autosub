import { randomUUID } from "node:crypto";
import {
  appendEvent,
  describeFailure,
  getRequestDetail,
  insertSnapshot,
  isDatabaseQueryError,
  type NewSubRequestEvent,
  type NewSubRequestSnapshot,
  type RequestDetail,
  type RequestPatch,
  readLeagueSettings,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import {
  type AdjustmentResult,
  hasMatchupEnded,
  type RequestActionType,
  type RequestEventType,
  type TransitionRefusal,
  type TransitionResult,
  toTenths,
  transition,
  writeGateFor,
} from "@injurysub/domain";
import type { TeamWeekRead } from "@injurysub/espn";
import { readTeamWeek } from "./board";
import { approval, reapproval, recomputed } from "./commish-approval";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";
import { REQUEST_ID } from "./request-view";

export type CommissionerAction =
  | "approve"
  | "reapprove"
  | "reject"
  | "override"
  | "complete"
  | "reverse";

export type CommissionerActionResult = {
  status:
    | "approved"
    | "reapproved"
    | "amount_changed"
    | "week_ended"
    | "automation_off"
    | "not_allowlisted"
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
export type Change = {
  patch: RequestPatch;
  eventType: RequestEventType;
  payload: Record<string, unknown>;
  snapshot: NewSubRequestSnapshot | null;
  done: CommissionerActionResult["status"];
};

type ActionInput = {
  actorUserId: string;
  // The commissioner's own team, which makes approving its request a self-approval (Q12).
  actorTeamId: number | null;
  requestId: string;
  action: CommissionerAction;
  form: FormData;
  now: Date;
};

const DOMAIN_ACTIONS: Record<CommissionerAction, RequestActionType> = {
  approve: "approve",
  reapprove: "reapprove",
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
// is kept as an event with who and when (H6). Nothing here writes to ESPN: an approval queues the
// request for the worker.
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
    if (request.kind === "proving" && !provingAllows(input.action, request)) {
      return { status: "not_allowed" };
    }
    const decided = await decide(input.action, request);
    if ("status" in decided) return decided;
    const change = await changeFor(input, detail, decided.read);
    if ("status" in change) return change;
    // The status is the domain's (lifecycle.ts), whatever else the action writes.
    const { status, reviewReason } = decided.allowed;
    return await applyChange(input, request, {
      ...change,
      patch: { ...change.patch, status, reviewReason },
    });
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.commish.database_failed", undefined, {
      flow: input.action,
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

// A proving request has no amount to override, reverse or re-approve (S9). It is closed by hand
// only once its swap is or may be on ESPN; one with nothing there is cancelled instead (S19).
const ON_ESPN: readonly SubRequestRecord["lineupState"][] = ["sent", "verified", "ambiguous"];

// Whether a request's lineup edit is, or may be, on ESPN.
export function swapMayBeOnEspn(request: SubRequestRecord): boolean {
  return ON_ESPN.includes(request.lineupState);
}

function provingAllows(action: CommissionerAction, request: SubRequestRecord): boolean {
  if (action === "approve" || action === "reject") return true;
  return action === "complete" && swapMayBeOnEspn(request);
}

type Decision = { allowed: Extract<TransitionResult, { ok: true }>; read: TeamWeekRead | null };

const APPROVAL_REFUSALS: readonly TransitionRefusal[] = [
  "week_ended",
  "automation_off",
  "not_allowlisted",
];

// The domain's rule for the action, under the league's settings as they stand and, for an
// approval that leaves the lineup still to write, ESPN's week now: it must be read, or nothing is
// approved (Q18, Q19). A held adjustment whose lineup is on ESPN needs no read.
async function decide(
  action: CommissionerAction,
  request: SubRequestRecord
): Promise<Decision | CommissionerActionResult> {
  const settings = await readLeagueSettings(getWebDatabaseConnection().db);
  const writeGate = writeGateFor(settings.writeAllowlist, request.teamId);
  const type = DOMAIN_ACTIONS[action];
  const before = transition(request, { type }, { matchupEnded: false, writeGate });
  if (!before.ok) return { status: refusalStatus(action, before.refusal) };
  const lineupToWrite =
    action === "approve" || (action === "reapprove" && request.lineupState !== "verified");
  if (!lineupToWrite) return { allowed: before, read: null };
  const read = await readTeamWeek(request.teamId);
  if ("status" in read) return { status: "espn_unreachable" };
  const matchupEnded = hasMatchupEnded(request, { season: read.meta.season, week: read.week });
  const allowed = transition(request, { type }, { matchupEnded, writeGate });
  return allowed.ok ? { allowed, read } : { status: refusalStatus(action, allowed.refusal) };
}

// An approval's refusal names its cause (Q19); every other action's is "not allowed".
function refusalStatus(
  action: CommissionerAction,
  refusal: TransitionRefusal
): CommissionerActionResult["status"] {
  const approving = action === "approve" || action === "reapprove";
  if (!approving || !APPROVAL_REFUSALS.includes(refusal)) return "not_allowed";
  return refusal === "week_ended" || refusal === "automation_off" ? refusal : "not_allowlisted";
}

async function changeFor(
  input: ActionInput,
  { request, events }: RequestDetail,
  read: TeamWeekRead | null
): Promise<Change | CommissionerActionResult> {
  switch (input.action) {
    case "approve":
      return read === null ? { status: "espn_unreachable" } : approval(input, request, read);
    case "reapprove":
      return reapproval(input, request, events);
    case "reject":
      return rejection(input.form);
    case "override":
      return overrideOf(input.form, request);
    case "complete":
      return request.kind === "proving" ? provingPutBack() : manualCompletion(input, request);
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

// "I put team 1 back": the commissioner's word that ESPN is as it was before the run, recorded
// without reading ESPN (S15). Nothing is owed.
function provingPutBack(): Change {
  return {
    patch: {
      effectiveDay: null,
      lineupState: "pending",
      adjustmentState: "not_owed",
      finalAdjustmentTenths: 0,
      ...DONE_ON_ESPN,
    },
    eventType: "completed_manually",
    payload: { proving: true, putBackByHand: true },
    snapshot: null,
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
