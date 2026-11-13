export const subRequestKinds = ["substitution", "on_behalf", "proving"] as const;
export type SubRequestKind = (typeof subRequestKinds)[number];

export const subRequestStatuses = [
  "refused",
  "awaiting_approval",
  "queued",
  "executing",
  "needs_review",
  "completed",
  "completed_manually",
  "rejected",
  "withdrawn",
  "reversed",
] as const;
export type SubRequestStatus = (typeof subRequestStatuses)[number];

export const reviewReasons = [
  "automation_off",
  "not_allowlisted",
  "rearrangement",
  "suspension",
  "stale",
  "ambiguous",
  "lineup_failed",
  "adjustment_failed",
  "adjustment_held_rules",
  "adjustment_changed",
  "expired",
  "week_ended",
  "playoffs",
] as const;
export type ReviewReason = (typeof reviewReasons)[number];

export const lineupStates = ["pending", "sent", "verified", "ambiguous", "failed"] as const;
export type LineupState = (typeof lineupStates)[number];

export const adjustmentStates = [
  "not_owed",
  "pending",
  "held",
  "sent",
  "verified",
  "failed",
] as const;
export type AdjustmentState = (typeof adjustmentStates)[number];

export type RequestState = {
  status: SubRequestStatus;
  reviewReason: ReviewReason | null;
  lineupState: LineupState;
  adjustmentState: AdjustmentState;
};

export type WriteGate = "open" | "automation_off" | "not_allowlisted";
export type ActionContext = { matchupEnded: boolean; writeGate: WriteGate };

export const requestActionTypes = [
  "withdraw",
  "reject",
  "approve",
  "reapprove",
  "override",
  "complete_manually",
  "reverse",
  "expire",
  "end_week",
] as const;
export type RequestActionType = (typeof requestActionTypes)[number];
export type RequestAction = { type: RequestActionType };

export type TransitionRefusal =
  | "not_allowed_in_status"
  | "already_on_espn"
  | "week_ended"
  | "automation_off"
  | "not_allowlisted";

export type TransitionResult =
  | { ok: true; status: SubRequestStatus; reviewReason: ReviewReason | null }
  | { ok: false; refusal: TransitionRefusal };

type Rule = (from: RequestState, context: ActionContext) => TransitionResult;

const ACCEPTED_BY_THE_COMMISSIONER: readonly SubRequestStatus[] = [
  "awaiting_approval",
  "needs_review",
];
// Review reasons approve may clear: the commissioner's case-by-case call on a suspension, and a
// plan re-checked again before any write. Every other reason is settled by hand.
const APPROVABLE_REVIEW_REASONS: readonly ReviewReason[] = ["suspension", "stale", "expired"];
const HELD_ADJUSTMENT_REASONS: readonly ReviewReason[] = [
  "adjustment_held_rules",
  "adjustment_changed",
];
const FREEING_STATUSES: readonly SubRequestStatus[] = ["refused", "rejected", "withdrawn"];
// The actions a person takes; expire and end_week are the worker's sweeps.
const PERSON_ACTIONS: readonly RequestActionType[] = [
  "withdraw",
  "reject",
  "approve",
  "reapprove",
  "override",
  "complete_manually",
  "reverse",
];

const refuse = (refusal: TransitionRefusal): TransitionResult => ({ ok: false, refusal });
const moveTo = (
  status: SubRequestStatus,
  reviewReason: ReviewReason | null = null
): TransitionResult => ({
  ok: true,
  status,
  reviewReason,
});

function isIn<T>(value: T, list: readonly T[]): boolean {
  return list.includes(value);
}

function gateRefusal({ writeGate }: ActionContext): TransitionResult | null {
  return writeGate === "open" ? null : refuse(writeGate);
}

const RULES: Record<RequestActionType, Rule> = {
  // Only while nothing was sent to ESPN for it.
  withdraw(from) {
    if (!isIn(from.status, ["queued", "awaiting_approval", "needs_review"])) {
      return refuse("not_allowed_in_status");
    }
    return from.lineupState === "pending" ? moveTo("withdrawn") : refuse("already_on_espn");
  },
  // Rejecting leaves ESPN untouched, so not once a lineup write was applied or may have been.
  reject(from) {
    if (!isIn(from.status, ACCEPTED_BY_THE_COMMISSIONER)) return refuse("not_allowed_in_status");
    return isIn(from.lineupState, ["pending", "failed"])
      ? moveTo("rejected")
      : refuse("already_on_espn");
  },
  approve(from, context) {
    const approvable =
      from.status === "awaiting_approval" ||
      (from.status === "needs_review" && isIn(from.reviewReason, APPROVABLE_REVIEW_REASONS));
    if (!approvable) return refuse("not_allowed_in_status");
    if (context.matchupEnded) return refuse("week_ended");
    return gateRefusal(context) ?? moveTo("queued");
  },
  // ESPN accepts an adjustment on a concluded matchup (probed 2026-11-04), so a held one can
  // still be written once the week is over.
  reapprove(from, context) {
    const held = from.status === "needs_review" && isIn(from.reviewReason, HELD_ADJUSTMENT_REASONS);
    if (!held) return refuse("not_allowed_in_status");
    return gateRefusal(context) ?? moveTo("queued");
  },
  override(from) {
    if (!isIn(from.status, ACCEPTED_BY_THE_COMMISSIONER)) return refuse("not_allowed_in_status");
    return moveTo(from.status, from.reviewReason);
  },
  complete_manually(from) {
    return isIn(from.status, ACCEPTED_BY_THE_COMMISSIONER)
      ? moveTo("completed_manually")
      : refuse("not_allowed_in_status");
  },
  reverse(from) {
    return isIn(from.status, ["completed", "completed_manually"])
      ? moveTo("reversed")
      : refuse("not_allowed_in_status");
  },
  expire(from) {
    return isIn(from.status, ["awaiting_approval", "queued"])
      ? moveTo("needs_review", "expired")
      : refuse("not_allowed_in_status");
  },
  end_week(from) {
    return isIn(from.status, ["awaiting_approval", "queued"])
      ? moveTo("needs_review", "week_ended")
      : refuse("not_allowed_in_status");
  },
};

// Where an action takes a request, or why it can't. The caller applies the result under the
// request's version, so of two actions at once only the first takes effect.
export function transition(
  from: RequestState,
  action: RequestAction,
  context: ActionContext
): TransitionResult {
  return RULES[action.type](from, context);
}

export function allowedActions(from: RequestState, context: ActionContext): RequestActionType[] {
  return PERSON_ACTIONS.filter((type) => transition(from, { type }, context).ok);
}

// Whether a request in this status keeps its injured player from another request that week.
export function blocksNewRequest(status: SubRequestStatus): boolean {
  return !isIn(status, FREEING_STATUSES);
}

// A request queued again picks up where it stopped: with its lineup verified on ESPN, at the
// adjustment (which re-runs its own checks); otherwise at the full preflight.
export function resumeStepFor(from: RequestState): "preflight" | "adjustment" {
  return from.lineupState === "verified" ? "adjustment" : "preflight";
}

// The executor's own moves: claiming a queued request whose preflight passed, and sending one it
// can't carry out to the commissioner, with the reason.
export type ExecutorMove = { type: "claim" } | { type: "review"; reason: ReviewReason };

export function executorTransition(from: RequestState, move: ExecutorMove): TransitionResult {
  if (move.type === "claim") {
    return from.status === "queued" ? moveTo("executing") : refuse("not_allowed_in_status");
  }
  return isIn(from.status, ["queued", "executing"])
    ? moveTo("needs_review", move.reason)
    : refuse("not_allowed_in_status");
}
