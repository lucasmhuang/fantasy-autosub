import { subRequestStatuses } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import {
  afterPoll,
  catchUp,
  type LiveStatus,
  POLL_GAVE_UP,
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
    expect(afterPoll(0, { kind: "answered", status: queued }, queued)).toEqual({
      next: "poll",
      delayMs: 3000,
      failures: 0,
      refresh: false,
    });
  });

  it("asks for the page again when the answer differs from what it shows", () => {
    const executing = { ...queued, status: "executing" as const };

    expect(afterPoll(0, { kind: "answered", status: executing }, queued)).toEqual({
      next: "poll",
      delayMs: 3000,
      failures: 0,
      refresh: true,
    });
  });

  it("keeps checking after a settled answer until the page shows it", () => {
    const done = { ...queued, status: "completed" as const };

    expect(afterPoll(0, { kind: "answered", status: done }, queued)).toEqual({
      next: "poll",
      delayMs: 3000,
      failures: 0,
      refresh: true,
    });
    expect(afterPoll(0, { kind: "answered", status: done }, done)).toEqual({
      next: "stop",
      reason: "settled",
    });
  });

  it("doubles the wait on each failure in a row, up to 30 seconds", () => {
    const waits: number[] = [];
    let failures = 0;
    for (let poll = 0; poll < 9; poll += 1) {
      const outcome = afterPoll(failures, { kind: "failed" }, queued);
      if (outcome.next !== "poll") throw new Error(`stopped after ${poll} failures`);
      waits.push(outcome.delayMs);
      failures = outcome.failures;
    }

    expect(waits).toEqual([6000, 12_000, 24_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it("gives up after 10 failures in a row, saying to reload", () => {
    expect(afterPoll(9, { kind: "failed" }, queued)).toEqual({ next: "stop", reason: "gave_up" });
    expect(POLL_GAVE_UP).toBe("Couldn't refresh. Reload to try again.");
  });

  it("starts the count again after an answer", () => {
    expect(afterPoll(8, { kind: "answered", status: queued }, queued)).toEqual({
      next: "poll",
      delayMs: 3000,
      failures: 0,
      refresh: false,
    });
  });

  it("gives up at once when the request is no longer this person's to see", () => {
    expect(afterPoll(0, { kind: "refused" }, queued)).toEqual({ next: "stop", reason: "gave_up" });
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

describe("catchUp", () => {
  it("re-renders in place, and reloads once two re-renders in a row haven't landed", () => {
    expect([1, 2, 3, 4].map(catchUp)).toEqual(["refresh", "refresh", "reload", "reload"]);
  });
});
