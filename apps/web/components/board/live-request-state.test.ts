import { subRequestStatuses } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import {
  afterPoll,
  arrivalMotion,
  changeMotions,
  FIRST_POLL_MS,
  type FoundRequestView,
  type LiveStatus,
  liveStatusOf,
  POLL_GAVE_UP,
  reviveRequestView,
  SWAP_ENDS_MS,
  sameStatus,
  stillMoving,
} from "./live-request-state";

const queued: LiveStatus = {
  requestId: "6f1b2a3c-0000-4000-8000-000000000001",
  status: "queued",
  reviewReason: null,
  delayed: false,
  notStarted: false,
  adjustmentNotSent: false,
  adjustmentTenths: -126,
  adjustmentIsFinal: false,
  ahead: null,
  alertEmail: "unknown",
  canWithdraw: true,
  sentEditDiffers: false,
  tracker: {
    checkedAt: null,
    lineupSentAt: null,
    lineupVerifiedAt: null,
    adjustmentSentAt: null,
    adjustmentVerifiedAt: null,
    completedAt: null,
  },
  rehearsal: false,
  events: 1,
};

describe("stillMoving", () => {
  it("keeps checking while the request is in line, running or waiting on the commissioner", () => {
    const moving = subRequestStatuses.filter(stillMoving);

    expect(moving.sort()).toEqual(["awaiting_approval", "executing", "needs_review", "queued"]);
  });
});

describe("afterPoll", () => {
  it("checks again in 3 seconds after an answer that hasn't settled", () => {
    expect(afterPoll(0, { kind: "answered", status: queued })).toEqual({
      next: "poll",
      delayMs: 3000,
      failures: 0,
    });
  });

  it("stops once the request settles", () => {
    const done = { ...queued, status: "completed" as const };

    expect(afterPoll(0, { kind: "answered", status: done })).toEqual({
      next: "stop",
      reason: "settled",
    });
  });

  it("doubles the wait on each failure in a row, up to 30 seconds", () => {
    const waits: number[] = [];
    let failures = 0;
    for (let poll = 0; poll < 9; poll += 1) {
      const outcome = afterPoll(failures, { kind: "failed" });
      if (outcome.next !== "poll") throw new Error(`stopped after ${poll} failures`);
      waits.push(outcome.delayMs);
      failures = outcome.failures;
    }

    expect(waits).toEqual([6000, 12_000, 24_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it("gives up after 10 failures in a row, saying to reload", () => {
    expect(afterPoll(9, { kind: "failed" })).toEqual({ next: "stop", reason: "gave_up" });
    expect(POLL_GAVE_UP).toBe("Couldn't refresh. Reload to try again.");
  });

  it("starts the count again after an answer", () => {
    expect(afterPoll(8, { kind: "answered", status: queued })).toEqual({
      next: "poll",
      delayMs: 3000,
      failures: 0,
    });
  });

  it("gives up at once when the request is no longer this person's to see", () => {
    expect(afterPoll(0, { kind: "refused" })).toEqual({ next: "stop", reason: "gave_up" });
  });
});

describe("sameStatus", () => {
  it("is true for an answer that brings nothing new, so nothing on screen changes", () => {
    expect(sameStatus(queued, { ...queued })).toBe(true);
  });

  it("notices any field that changes", () => {
    expect(sameStatus(queued, { ...queued, status: "executing" })).toBe(false);
    expect(sameStatus(queued, { ...queued, delayed: true })).toBe(false);
    expect(sameStatus(queued, { ...queued, alertEmail: "sent" })).toBe(false);
    expect(
      sameStatus(queued, {
        ...queued,
        tracker: { ...queued.tracker, lineupSentAt: "2026-11-16T09:00:00.000Z" },
      })
    ).toBe(false);
    expect(sameStatus(queued, { ...queued, events: 2 })).toBe(false);
  });
});

describe("arrivalMotion", () => {
  it("plays the swap on the stage when InjurySub acts next, and in the rows when a person does", () => {
    expect(arrivalMotion("queued")).toBe("stage");
    expect(arrivalMotion("executing")).toBe("stage");
    expect(arrivalMotion("awaiting_approval")).toBe("rows");
    expect(arrivalMotion("needs_review")).toBe("rows");
    expect(arrivalMotion("refused")).toBeNull();
    expect(arrivalMotion("completed")).toBeNull();
  });

  // IF-MOTION-18: a status never arrives mid-swap, since the first check comes after it ends.
  it("ends before the page's first check", () => {
    expect(SWAP_ENDS_MS).toBeLessThanOrEqual(700);
    expect(FIRST_POLL_MS).toBeGreaterThan(SWAP_ENDS_MS);
  });
});

describe("changeMotions", () => {
  const executing = { ...queued, status: "executing" as const };
  const done = { ...queued, status: "completed" as const };

  it("plays nothing on the page's first state, or for an answer that brings nothing new", () => {
    expect(changeMotions(null, queued)).toEqual([]);
    expect(changeMotions(queued, { ...queued })).toEqual([]);
  });

  it("crossfades the status when it changes", () => {
    expect(changeMotions(queued, executing)).toEqual(["status"]);
    expect(changeMotions(queued, { ...queued, delayed: true })).toEqual(["status"]);
  });

  it("plays Done and shows what ESPN shows when it completes with the page open", () => {
    expect(changeMotions(executing, done)).toEqual(["status", "done", "espn"]);
  });

  it("never plays Done for a rehearsal, which only shows what it would have sent", () => {
    expect(changeMotions(executing, { ...done, rehearsal: true })).toEqual(["status", "espn"]);
  });

  it("brings the stage in when a request that waited on a person starts running", () => {
    const waiting = { ...queued, status: "awaiting_approval" as const };

    expect(changeMotions(waiting, queued)).toEqual(["status", "stage"]);
  });

  it("rolls the adjustment in the direction it changed", () => {
    expect(changeMotions(queued, { ...queued, adjustmentTenths: -130 })).toEqual(["number-down"]);
    expect(changeMotions(queued, { ...queued, adjustmentTenths: -120 })).toEqual(["number-up"]);
  });
});

describe("reviveRequestView", () => {
  const at = new Date("2026-10-28T01:41:00.000Z");
  const view: FoundRequestView = {
    status: "found",
    request: {
      requestId: queued.requestId,
      status: "executing",
      reviewReason: null,
      refusalReason: null,
      injuredPlayerId: 6606,
      injuredName: "Damian Lillard",
      injuredSlot: "G",
      replacementPlayerId: 5144091,
      replacementName: "Jeremiah Fears",
      filedAt: at,
      requestMoment: at,
      requestDay: 8,
      matchupPeriodId: 2,
      adjustmentTenths: -126,
      adjustmentIsFinal: false,
      effectiveDay: null,
      rehearsal: false,
    },
    breakdown: [],
    commissionerReason: null,
    canWithdraw: false,
    delayed: false,
    notStarted: false,
    adjustmentNotSent: false,
    sentEdit: null,
    tracker: {
      checkedAt: at,
      lineupSentAt: null,
      lineupVerifiedAt: null,
      adjustmentSentAt: null,
      adjustmentVerifiedAt: null,
      completedAt: null,
    },
    ahead: null,
    alertEmail: { state: "sent", at },
    events: [{ at, type: "request_filed", actor: "manager" }],
    refusal: null,
  };

  it("reads the status route's answer back into the page's view, its instants as dates", () => {
    const revived = reviveRequestView(JSON.stringify(view), queued.requestId);

    expect(revived).toEqual(view);
    expect(revived?.request.filedAt).toBeInstanceOf(Date);
    expect(liveStatusOf(revived as FoundRequestView).status).toBe("executing");
  });

  it("keeps text that looks like a time as text, such as a commissioner's reason", () => {
    const reason = "2026-11-16T10:00:00Z";
    const revived = reviveRequestView(
      JSON.stringify({ ...view, commissionerReason: reason }),
      queued.requestId
    );

    expect(revived?.commissionerReason).toBe(reason);
  });

  it("refuses an answer for another request, or that isn't a request's view", () => {
    expect(reviveRequestView(JSON.stringify(view), "another-request")).toBeNull();
    expect(reviveRequestView(JSON.stringify({ status: "not_found" }), queued.requestId)).toBeNull();
    const noTracker = JSON.stringify({ ...view, tracker: undefined });
    expect(reviveRequestView(noTracker, queued.requestId)).toBeNull();
  });

  it("refuses a view whose changing fields aren't the shapes the page reads", () => {
    const revive = (patch: Record<string, unknown>, request: Record<string, unknown> = {}) =>
      reviveRequestView(
        JSON.stringify({ ...view, ...patch, request: { ...view.request, ...request } }),
        queued.requestId
      );

    expect(revive({}, { status: "paused" })).toBeNull();
    expect(revive({}, { reviewReason: "no_such_reason" })).toBeNull();
    expect(revive({}, { adjustmentTenths: "-126" })).toBeNull();
    expect(revive({ delayed: "no" })).toBeNull();
    expect(revive({ alertEmail: { state: "bounced", at } })).toBeNull();
    expect(revive({ ahead: { kind: "elsewhere" } })).toBeNull();
    expect(revive({ tracker: { ...view.tracker, lineupSentAt: 7 } })).toBeNull();
    expect(revive({ events: 5 })).toBeNull();
    expect(revive({}, { reviewReason: "stale", adjustmentTenths: null })).not.toBeNull();
    expect(revive({ ahead: { kind: "other" } })).not.toBeNull();
  });
});
