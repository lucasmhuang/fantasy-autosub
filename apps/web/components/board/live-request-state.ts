import { reviewReasons, type SubRequestStatus, subRequestStatuses } from "@injurysub/domain";
import { z } from "zod";

// What the request page's poll answers (`GET /requests/:id/status`): every field the page shows
// that can change while it's open. The route builds it and the poller reads it through this schema.
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

export const POLL_GAVE_UP = "Couldn't refresh. Reload to try again.";

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
  // `refresh`: render the page again, since the answer differs from what it shows.
  | { next: "poll"; delayMs: number; failures: number; refresh: boolean }
  | { next: "stop"; reason: "settled" | "gave_up" };

// What the poller does after each check, given the status the page shows now: 3 s while it
// answers, doubling on each failure in a row to 30 s, and giving up after 10 (FM-REQUEST-7). An
// answer that differs from the page asks for the page again, and checking goes on until the page
// shows it, a settled answer included: a re-render can be dropped, and the next check repeats it.
export function afterPoll(failures: number, outcome: PollOutcome, shown: LiveStatus): NextPoll {
  if (outcome.kind === "refused") return { next: "stop", reason: "gave_up" };
  if (outcome.kind === "answered") {
    const refresh = !sameStatus(shown, outcome.status);
    if (!refresh && !stillMoving(outcome.status.status)) return { next: "stop", reason: "settled" };
    return { next: "poll", delayMs: POLL_MS, failures: 0, refresh };
  }
  const inARow = failures + 1;
  if (inARow >= MAX_FAILURES) return { next: "stop", reason: "gave_up" };
  const delayMs = Math.min(POLL_MS * 2 ** inARow, MAX_WAIT_MS);
  return { next: "poll", delayMs, failures: inARow, refresh: false };
}

const RELOAD_AFTER = 3;

// How the page catches up with an answer that differs from it, given how many checks in a row
// have found it behind: re-render in place, and reload if two re-renders in a row haven't landed.
// On the commissioner's page, Next's refresh sometimes never commits when the Queue count changes
// with the request (R7d-6's walk), and the router then drops each later refresh.
export function catchUp(behind: number): "refresh" | "reload" {
  return behind >= RELOAD_AFTER ? "reload" : "refresh";
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
