import { describe, expect, it } from "vitest";
import type { RequestView, TrackerTimes } from "../../lib/server/request-view";
import { recordText, requestStatusPanel, reviewReasonWords, trackerSteps } from "./request-copy";

type Found = Extract<RequestView, { status: "found" }>;

const PT = "America/Los_Angeles";
const NOW = new Date("2026-10-28T02:00:00.000Z");
const ASKED = new Date("2026-10-28T01:41:00.000Z");
const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 1, minute));
const NO_TIMES: TrackerTimes = {
  checkedAt: null,
  lineupSentAt: null,
  lineupVerifiedAt: null,
  adjustmentSentAt: null,
  adjustmentVerifiedAt: null,
  completedAt: null,
};

const view = (request: Partial<Found["request"]> = {}, fields: Partial<Found> = {}): Found => ({
  status: "found",
  request: {
    requestId: "44444444-4444-4444-8444-444444444444",
    status: "queued",
    reviewReason: null,
    refusalReason: null,
    injuredPlayerId: 6606,
    injuredName: "Damian Lillard",
    injuredSlot: "G",
    replacementPlayerId: 5144091,
    replacementName: "Jeremiah Fears",
    filedAt: ASKED,
    requestMoment: ASKED,
    requestDay: 8,
    matchupPeriodId: 2,
    adjustmentTenths: -878,
    adjustmentIsFinal: false,
    effectiveDay: null,
    rehearsal: false,
    ...request,
  },
  breakdown: [],
  commissionerReason: null,
  canWithdraw: true,
  delayed: false,
  notStarted: false,
  adjustmentNotSent: false,
  sentEdit: null,
  tracker: NO_TIMES,
  ahead: null,
  alertEmail: { state: "unknown" },
  events: [],
  ...fields,
});

const panel = (found: Found) =>
  requestStatusPanel(found, { zone: PT, now: NOW, commissioner: "Sam" });

describe("requestStatusPanel", () => {
  it("says who acts next while it's in line, naming only the team's own swap ahead", () => {
    expect(
      panel(view({}, { ahead: { kind: "own", title: "Kessler in for Booker" } }))
    ).toMatchObject({
      tone: "busy",
      word: "In line",
      who: "InjurySub acts next",
      sentence: "Runs after Kessler in for Booker finishes, usually within a minute.",
    });
    expect(panel(view({}, { ahead: { kind: "other" } })).sentence).toBe(
      "Another team's swap goes first. Usually under a minute."
    );
  });

  it("says when it's delayed by ESPN's access or not started while InjurySub is down", () => {
    expect(panel(view({}, { delayed: true }))).toMatchObject({
      word: "Delayed",
      who: "Sam fixes ESPN access",
      sentence:
        "Nothing has been sent yet. It runs once access is back; Fears's points count from Tue 6:41 PM PT.",
    });
    expect(panel(view({}, { notStarted: true }))).toMatchObject({
      tone: "neutral",
      word: "Not started",
      sentence: "InjurySub is down, so nothing has been sent. It runs when InjurySub is back.",
    });
  });

  it("says what waiting on the commissioner means, and when they were emailed", () => {
    expect(
      panel(view({ status: "awaiting_approval" }, { alertEmail: { state: "sent", at: at(41) } }))
    ).toMatchObject({
      tone: "wait",
      word: "Waiting for approval",
      who: "Sam decides",
      sentence:
        "Nothing changes on ESPN until they approve. Fears's points count from Tue 6:41 PM PT either way. Sam was emailed Tue 6:41 PM PT.",
    });
    expect(panel(view({ status: "needs_review", reviewReason: "automation_off" })).sentence).toBe(
      "Sam is making swaps by hand for now. Fears's points count from Tue 6:41 PM PT."
    );
  });

  it("says done, never on a rehearsal, and the commissioner's own settling", () => {
    expect(
      panel(view({ status: "completed" }, { tracker: { ...NO_TIMES, completedAt: at(42) } }))
    ).toMatchObject({
      tone: "ok",
      word: "Done",
      who: "On ESPN Tue 6:42 PM PT",
    });
    expect(panel(view({ status: "completed", rehearsal: true }))).toMatchObject({
      tone: "neutral",
      word: "Rehearsal",
      who: "Nothing was sent to ESPN",
    });
    expect(panel(view({ status: "completed_manually" })).word).toBe("Done by Sam");
  });

  it("says why it stopped, freeing the starter or not", () => {
    expect(
      panel(view({ status: "rejected" }, { commissionerReason: "He played Monday." }))
    ).toMatchObject({
      word: "Rejected",
      who: "Lillard is free for a new request",
      sentence: 'Sam declined it: "He played Monday."',
    });
    expect(panel(view({ status: "withdrawn" })).sentence).toBe("Nothing was sent to ESPN.");
    expect(panel(view({ status: "reversed" })).who).toBe(
      "Lillard can't be requested again this week"
    );
    expect(panel(view({ status: "refused", refusalReason: "not_out" }))).toMatchObject({
      word: "Refused",
      who: "Nothing happened on ESPN",
      sentence: "Player is no longer listed as OUT.",
    });
  });
});

describe("reviewReasonWords", () => {
  it("gives every reason the manager's words", () => {
    for (const reason of [
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
    ] as const) {
      expect(reviewReasonWords(reason, "Sam", "Lillard")).toMatch(/\S/);
    }
    expect(reviewReasonWords("suspension", "Sam", "Lillard")).toBe(
      "Lillard is suspended, not OUT, so Sam decides."
    );
  });
});

describe("trackerSteps", () => {
  it("marks each step done with its time, the next one active, and a skipped adjustment", () => {
    const steps = trackerSteps(
      "executing",
      { ...NO_TIMES, checkedAt: at(41), lineupSentAt: at(41) },
      { owed: true, zone: PT }
    );

    expect(steps).toEqual([
      { label: "Checked", state: "done", note: "6:41 PM PT" },
      { label: "Lineup", state: "active", note: "sent 6:41 PM PT" },
      { label: "Adjustment", state: "todo", note: "—" },
      { label: "Done", state: "todo", note: "—" },
    ]);
    expect(
      trackerSteps(
        "completed",
        {
          ...NO_TIMES,
          checkedAt: at(1),
          lineupSentAt: at(1),
          lineupVerifiedAt: at(1),
          completedAt: at(1),
        },
        { owed: false, zone: PT }
      )[2]
    ).toEqual({ label: "Adjustment", state: "skip", note: "not owed" });
  });
});

describe("recordText", () => {
  it("says each event as the manager reads it", () => {
    expect(recordText("request_filed", "Fears in for Lillard", "Sam")).toBe(
      "Asked: Fears in for Lillard"
    );
    expect(recordText("approved", "Fears in for Lillard", "Sam")).toBe("Sam approved");
    expect(recordText("lineup_verified", "Fears in for Lillard", "Sam")).toBe(
      "Lineup changed on ESPN"
    );
  });
});
