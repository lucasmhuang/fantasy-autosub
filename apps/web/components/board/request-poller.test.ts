import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundRequestView } from "./live-request-state";
import { createRequestPoller, type PollerAnswer } from "./request-poller";

const REQUEST_ID = "6f1b2a3c-0000-4000-8000-000000000001";
const at = new Date("2026-10-28T01:41:00.000Z");

const view = (status: FoundRequestView["request"]["status"]): FoundRequestView => ({
  status: "found",
  request: {
    requestId: REQUEST_ID,
    status,
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
    checkedAt: null,
    lineupSentAt: null,
    lineupVerifiedAt: null,
    adjustmentSentAt: null,
    adjustmentVerifiedAt: null,
    completedAt: null,
  },
  ahead: null,
  alertEmail: { state: "unknown" },
  events: [{ at, type: "request_filed", actor: "manager" }],
});

const answered = (status: FoundRequestView["request"]["status"]): PollerAnswer => ({
  status: 200,
  text: JSON.stringify(view(status)),
});

// A fetch whose answers the test hands out one at a time, in any order.
// With `heedsAbort` false it answers even after its signal aborts, as a response already on its way
// can.
function deferredFetches(heedsAbort = true) {
  const pending: { resolve: (answer: PollerAnswer) => void; signal: AbortSignal }[] = [];
  const fetchText = (_path: string, signal: AbortSignal) =>
    new Promise<PollerAnswer>((resolve, reject) => {
      pending.push({ resolve, signal });
      if (!heedsAbort) return;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  return { pending, fetchText };
}

function setUp(fetchText: (path: string, signal: AbortSignal) => Promise<PollerAnswer>) {
  let shown = view("executing");
  let hidden = false;
  const applied: string[] = [];
  const gaveUp = vi.fn();
  const poller = createRequestPoller({
    requestId: REQUEST_ID,
    fetchText,
    shown: () => shown,
    apply: (next) => {
      shown = next;
      applied.push(next.request.status);
    },
    giveUp: gaveUp,
    isHidden: () => hidden,
  });
  return {
    poller,
    applied,
    gaveUp,
    hide: (value: boolean) => {
      hidden = value;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRequestPoller", () => {
  it("first checks after 3 seconds and applies an answer that differs", async () => {
    const { pending, fetchText } = deferredFetches();
    const { poller, applied } = setUp(fetchText);

    poller.start();
    await vi.advanceTimersByTimeAsync(2999);
    expect(pending).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    pending[0]?.resolve(answered("completed"));
    await vi.advanceTimersByTimeAsync(0);

    expect(applied).toEqual(["completed"]);
  });

  it("starts no second check when the tab comes back while one is in flight", async () => {
    const { pending, fetchText } = deferredFetches();
    const { poller, hide } = setUp(fetchText);

    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    hide(true);
    poller.visibilityChanged();
    hide(false);
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);

    expect(pending).toHaveLength(1);
  });

  it("checks at once when the tab comes back with no check in flight", async () => {
    const { pending, fetchText } = deferredFetches();
    const { poller, hide } = setUp(fetchText);

    poller.start();
    hide(true);
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toHaveLength(0);
    hide(false);
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);

    expect(pending).toHaveLength(1);
  });

  it("applies nothing that answers after it stopped", async () => {
    const { pending, fetchText } = deferredFetches(false);
    const { poller, applied } = setUp(fetchText);

    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    const late = pending[0];
    poller.stop();
    late?.resolve(answered("completed"));
    await vi.advanceTimersByTimeAsync(0);

    expect(applied).toEqual([]);
  });

  it("counts a check that hasn't answered in 15 seconds as failed, and tries again later", async () => {
    const { pending, fetchText } = deferredFetches();
    const { poller } = setUp(fetchText);

    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(pending[0]?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(pending[0]?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5999);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(pending).toHaveLength(2);
  });

  it("gives up, saying so, when the request is no longer this person's to see", async () => {
    const { poller, gaveUp } = setUp(async () => ({ status: 404, text: "" }));

    poller.start();
    await vi.advanceTimersByTimeAsync(3000);

    expect(gaveUp).toHaveBeenCalledOnce();
  });
});
