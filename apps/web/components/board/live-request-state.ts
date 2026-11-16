import { reviewReasons, type SubRequestStatus, subRequestStatuses } from "@injurysub/domain";
import { z } from "zod";
import type { RequestView } from "../../lib/server/request-view";

export type FoundRequestView = Extract<RequestView, { status: "found" }>;

// The fields of a request's view that can change while its page is open, compared between checks
// to tell whether anything changed and which motion it plays.
const instant = z.string().nullable();
export const liveStatusSchema = z.object({
  requestId: z.string(),
  status: z.enum(subRequestStatuses),
  reviewReason: z.enum(reviewReasons).nullable(),
  delayed: z.boolean(),
  notStarted: z.boolean(),
  adjustmentNotSent: z.boolean(),
  adjustmentTenths: z.number().nullable(),
  adjustmentIsFinal: z.boolean(),
  ahead: z.enum(["own", "other"]).nullable(),
  alertEmail: z.enum(["unknown", "pending", "sent", "failed"]),
  canWithdraw: z.boolean(),
  sentEditDiffers: z.boolean(),
  // Its latest run sent nothing to ESPN, so Done never plays for it.
  rehearsal: z.boolean(),
  tracker: z.object({
    checkedAt: instant,
    lineupSentAt: instant,
    lineupVerifiedAt: instant,
    adjustmentSentAt: instant,
    adjustmentVerifiedAt: instant,
    completedAt: instant,
  }),
  // The record's length: a new event is a change even where no other field moved.
  events: z.number(),
});
export type LiveStatus = z.infer<typeof liveStatusSchema>;

export function liveStatusOf(view: FoundRequestView): LiveStatus {
  const { request, tracker } = view;
  const at = (moment: Date | null) => moment?.toISOString() ?? null;
  return {
    requestId: request.requestId,
    status: request.status,
    reviewReason: request.reviewReason,
    delayed: view.delayed,
    notStarted: view.notStarted,
    adjustmentNotSent: view.adjustmentNotSent,
    adjustmentTenths: request.adjustmentTenths,
    adjustmentIsFinal: request.adjustmentIsFinal,
    ahead: view.ahead?.kind ?? null,
    alertEmail: view.alertEmail.state,
    canWithdraw: view.canWithdraw,
    sentEditDiffers: view.sentEdit?.differsFromConfirmed ?? false,
    rehearsal: request.rehearsal,
    tracker: {
      checkedAt: at(tracker.checkedAt),
      lineupSentAt: at(tracker.lineupSentAt),
      lineupVerifiedAt: at(tracker.lineupVerifiedAt),
      adjustmentSentAt: at(tracker.adjustmentSentAt),
      adjustmentVerifiedAt: at(tracker.adjustmentVerifiedAt),
      completedAt: at(tracker.completedAt),
    },
    events: view.events.length,
  };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// The status route's answer (`GET /requests/:id/status`) is the page's view as JSON, its instants
// as ISO strings. Null when it isn't that request's view.
export function reviveRequestView(text: string, requestId: string): FoundRequestView | null {
  const view: FoundRequestView = JSON.parse(text, (_key, value: unknown) =>
    typeof value === "string" && ISO_INSTANT.test(value) ? new Date(value) : value
  );
  if (view?.status !== "found" || view.request?.requestId !== requestId) return null;
  try {
    return liveStatusSchema.safeParse(liveStatusOf(view)).success ? view : null;
  } catch (error) {
    // A view missing a part the page reads.
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export const POLL_GAVE_UP = "Couldn't refresh. Reload to try again.";

// The first check waits until any arrival swap has ended (IF-MOTION-18).
export const FIRST_POLL_MS = 3000;
// The swap: a 200 ms settle, then 500 ms of movement.
export const SWAP_ENDS_MS = 700;

const POLL_MS = 3000;
const MAX_WAIT_MS = 30_000;
const MAX_FAILURES = 10;

const MOVING: readonly SubRequestStatus[] = [
  "queued",
  "executing",
  "awaiting_approval",
  "needs_review",
];

// The page keeps checking while the request can still change by itself: in line, running, or
// waiting on the commissioner, whose approval changes it in place (IF-REQUEST-7).
export function stillMoving(status: SubRequestStatus): boolean {
  return MOVING.includes(status);
}

export type PollOutcome =
  | { kind: "answered"; status: LiveStatus }
  | { kind: "failed" }
  // Signed out, or the request isn't this person's to see: checking again can't help.
  | { kind: "refused" };

export type NextPoll =
  | { next: "poll"; delayMs: number; failures: number }
  | { next: "stop"; reason: "settled" | "gave_up" };

// What the poller does after each check: 3 s while it answers, doubling on each failure in a row
// to 30 s, and giving up after 10 (FM-REQUEST-7). It stops once the request settles.
export function afterPoll(failures: number, outcome: PollOutcome): NextPoll {
  if (outcome.kind === "refused") return { next: "stop", reason: "gave_up" };
  if (outcome.kind === "answered") {
    return stillMoving(outcome.status.status)
      ? { next: "poll", delayMs: POLL_MS, failures: 0 }
      : { next: "stop", reason: "settled" };
  }
  const inARow = failures + 1;
  if (inARow >= MAX_FAILURES) return { next: "stop", reason: "gave_up" };
  return { next: "poll", delayMs: Math.min(POLL_MS * 2 ** inARow, MAX_WAIT_MS), failures: inARow };
}

export type ArrivalMotion = "stage" | "rows";

const STAGED: readonly SubRequestStatus[] = ["queued", "executing"];
const WAITING_ON_A_PERSON: readonly SubRequestStatus[] = ["awaiting_approval", "needs_review"];

// Arriving from Confirm plays the swap once: on the card stage while InjurySub acts next, in the
// two rows while a person does (IF-MOTION-1, IF-MOTION-2).
export function arrivalMotion(status: SubRequestStatus): ArrivalMotion | null {
  if (STAGED.includes(status)) return "stage";
  if (WAITING_ON_A_PERSON.includes(status)) return "rows";
  return null;
}

export type ChangeMotion = "status" | "done" | "espn" | "stage" | "number-up" | "number-down";

// What a change seen while the page is open plays (IF-MOTION-4 to -9). Nothing on the page's first
// state: a later visit or a reload shows the result at rest (FS-MOTION-1).
export function changeMotions(before: LiveStatus | null, after: LiveStatus): ChangeMotion[] {
  if (before === null || sameStatus(before, after)) return [];
  const motions: ChangeMotion[] = [];
  const panel = ["status", "reviewReason", "delayed", "notStarted", "adjustmentNotSent"] as const;
  if (panel.some((field) => before[field] !== after[field])) motions.push("status");
  const completed = after.status === "completed" && before.status !== "completed";
  if (completed && !after.rehearsal) motions.push("done");
  if (completed) motions.push("espn");
  if (WAITING_ON_A_PERSON.includes(before.status) && STAGED.includes(after.status)) {
    motions.push("stage");
  }
  const { adjustmentTenths: was } = before;
  const { adjustmentTenths: now } = after;
  if (was !== null && now !== null && was !== now) {
    motions.push(now > was ? "number-up" : "number-down");
  }
  return motions;
}

// An answer that brings nothing new changes nothing on screen (IF-MOTION-19).
export function sameStatus(a: LiveStatus, b: LiveStatus): boolean {
  const { tracker: trackerA, ...restA } = a;
  const { tracker: trackerB, ...restB } = b;
  return sameFields(restA, restB) && sameFields(trackerA, trackerB);
}

function sameFields<T extends Record<string, unknown>>(a: T, b: T): boolean {
  return Object.keys(a).every((key) => a[key] === b[key]);
}
