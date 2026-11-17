import type { ReviewReason } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import type { QueueAlert, QueueHealth, QueueRequest, ReviewFacts } from "../../lib/server/queue";
import { alertRowWords, healthWords, requestRowWords } from "./queue-copy";

const reading = { zone: "America/Los_Angeles", now: new Date("2026-11-17T05:00:00.000Z") };
// Mon 8:10 PM PT, as every row reads it.
const t = new Date("2026-11-17T04:10:00.000Z");
const NO_FACTS: ReviewFacts = {
  reviewedAt: null,
  otherMoves: [],
  sentTenths: null,
  approvedTenths: null,
  heldTenths: null,
  mismatches: [],
};

function request(overrides: Partial<QueueRequest> = {}): QueueRequest {
  return {
    kind: "request",
    requestId: "r1",
    teamId: 4,
    teamName: "Stretch Fours",
    injured: { playerId: 1, name: "Domantas Sabonis" },
    replacement: { playerId: 2, name: "Jonas Valančiūnas" },
    status: "needs_review",
    reviewReason: "automation_off",
    filedAt: t,
    expiresAt: null,
    matchupPeriodId: 4,
    amountTenths: -310,
    amountFinal: false,
    facts: NO_FACTS,
    ...overrides,
  };
}

const reasonOf = (reviewReason: ReviewReason, facts: Partial<ReviewFacts> = {}) =>
  requestRowWords(request({ reviewReason, facts: { ...NO_FACTS, ...facts } }), reading).needs;

describe("requestRowWords", () => {
  it("names the team, the swap by surname, when it was filed and the projected amount", () => {
    expect(requestRowWords(request(), reading)).toMatchObject({
      team: "Stretch Fours",
      swap: "Valančiūnas in for Sabonis",
      when: "Mon 8:10 PM PT",
      amount: "−31.0 proj.",
    });
  });

  it("calls a team ESPN's name wasn't read for by its number", () => {
    expect(requestRowWords(request({ teamName: null }), reading).team).toBe("Team 4");
  });

  it("shows a settled amount plainly, and none for a stopped request or no amount", () => {
    const words = (overrides: Partial<QueueRequest>) =>
      requestRowWords(request({ status: "completed", facts: null, ...overrides }), reading).amount;
    expect(words({ amountTenths: -878, amountFinal: true })).toBe("−87.8");
    expect(words({ amountTenths: 51, amountFinal: true })).toBe("+5.1");
    expect(words({ status: "rejected" })).toBe("—");
    expect(words({ status: "reversed", amountTenths: -878, amountFinal: true })).toBe("—");
    expect(words({ amountTenths: null })).toBe("—");
    expect(words({ amountTenths: 0, amountFinal: true })).toBe("—");
  });

  it("gives every other request its status, done by hand as the commissioner's own", () => {
    const status = (s: QueueRequest["status"]) =>
      requestRowWords(request({ status: s, reviewReason: null, facts: null }), reading).status;
    expect(status("completed_manually")).toEqual({ kind: "done", word: "Done by you" });
    expect(status("queued")).toEqual({ kind: "in-line", word: "In line" });
    expect(status("rejected")).toEqual({ kind: "stopped", word: "Rejected" });
  });

  it("says when an approval expires", () => {
    const words = requestRowWords(
      request({ status: "awaiting_approval", reviewReason: null, expiresAt: t }),
      reading
    );
    expect(words.needs).toEqual({ reason: "Approval", sentence: "Expires Mon 8:10 PM PT." });
  });

  it("gives each review reason its pill and its sentence", () => {
    expect(reasonOf("automation_off")).toEqual({
      reason: "Automation off",
      sentence: "Automation is off.",
    });
    expect(reasonOf("not_allowlisted")).toEqual({
      reason: "Not enabled",
      sentence: "Stretch Fours isn't ticked in Settings.",
    });
    expect(
      reasonOf("rearrangement", {
        otherMoves: [
          { name: "Lauri Markkanen", toSlot: "F/C" },
          { name: "Bam Adebayo", toSlot: "C" },
        ],
      })
    ).toEqual({
      reason: "Rearrangement",
      sentence: "Two other starters would move: Markkanen to F/C, Adebayo to C.",
    });
    expect(reasonOf("suspension")?.sentence).toBe("Sabonis is suspended, not OUT.");
    expect(reasonOf("stale")).toEqual({
      reason: "Lineup changed",
      sentence: "Lineup changed on ESPN after the request; nothing was sent.",
    });
    expect(reasonOf("ambiguous")).toEqual({
      reason: "Check ESPN",
      sentence: "ESPN's lineup didn't match after the change.",
    });
    expect(reasonOf("lineup_failed", { reviewedAt: t })).toEqual({
      reason: "Lineup failed",
      sentence: "ESPN refused the lineup change at Mon 8:10 PM PT; nothing else was sent.",
    });
  });

  it("gives each adjustment reason the amounts and rules it names", () => {
    expect(reasonOf("adjustment_failed", { sentTenths: -194 })).toEqual({
      reason: "Adjustment failed",
      sentence: "Lineup done; ESPN refused the −19.4 adjustment.",
    });
    expect(reasonOf("adjustment_failed")?.sentence).toBe(
      "Lineup done; the adjustment wasn't posted."
    );
    expect(
      reasonOf("adjustment_held_rules", {
        mismatches: [{ kind: "setting", setting: "Steals points", expected: "3", espn: "2" }],
      })
    ).toEqual({
      reason: "Adjustment held",
      sentence: "League rules differ: Steals points is 2 on ESPN, InjurySub expects 3.",
    });
    expect(reasonOf("adjustment_changed", { approvedTenths: -821, heldTenths: -878 })).toEqual({
      reason: "Amount changed",
      sentence: "−82.1 when you approved, −87.8 now.",
    });
  });

  it("gives the reasons a sweep or the calendar sets their sentences", () => {
    expect(reasonOf("expired")).toEqual({
      reason: "Expired",
      sentence: "Waited 12 hours without running (filed Mon 8:10 PM PT).",
    });
    expect(reasonOf("week_ended")).toEqual({
      reason: "Week ended",
      sentence: "Week 4 ended before it ran; post the adjustment only.",
    });
    expect(reasonOf("playoffs")).toEqual({
      reason: "Playoffs",
      sentence: "Playoff weeks always come to you.",
    });
  });
});

describe("alertRowWords", () => {
  const alert = (overrides: Partial<QueueAlert>): QueueAlert => ({
    kind: "alert",
    alertId: "a1",
    alertKind: "lm_transaction",
    teamId: 4,
    teamName: "Backdoor Cutters",
    at: t,
    ...overrides,
  });

  it("reads Misuse watch, its summary, and what to do", () => {
    expect(alertRowWords(alert({}), reading)).toEqual({
      team: "Misuse watch",
      swap: "A lineup change on Backdoor Cutters InjurySub didn't make",
      when: "Mon 8:10 PM PT",
      amount: "—",
      needs: { reason: "Alert", sentence: "Acknowledge it, or undo it on ESPN." },
    });
  });

  it("sums up each kind of alert", () => {
    const summary = (overrides: Partial<QueueAlert>) =>
      alertRowWords(alert(overrides), reading).swap;
    expect(summary({ alertKind: "lm_adjustment", teamName: null })).toBe(
      "A score adjustment on Team 4 InjurySub didn't make"
    );
    expect(summary({ alertKind: "lm_league_change", teamId: null, teamName: null })).toBe(
      "A league setting change InjurySub didn't make"
    );
    expect(summary({ alertKind: "adjustment_mismatch" })).toBe(
      "Backdoor Cutters's adjustment on ESPN differs from InjurySub's"
    );
    expect(summary({ alertKind: "league_public", teamId: null })).toBe(
      "The league was made public"
    );
  });
});

const ALL_WELL: QueueHealth = {
  espn: { state: "working", since: t, checkedAt: t },
  blockedCount: 0,
  worker: { lastBeatAt: t, down: false },
  rules: { mismatches: [], checkedAt: t, lastMatchedAt: t },
  watch: { state: "watching", checkedAt: t },
};

describe("healthWords", () => {
  it("is all well, with the misuse watch on its own line", () => {
    const words = healthWords(ALL_WELL, reading);
    expect(words.checks.map(({ mark }) => mark)).toEqual(["ok", "ok", "ok"]);
    expect(words.summaryWhen).toBe("Mon 8:10 PM PT");
    expect(words.separate).toEqual({
      name: "Misuse watch",
      mark: "ok",
      state: "Watching",
      when: "checked Mon 8:10 PM PT",
      href: "/commish/alerts",
    });
  });

  it("says ESPN refused access, how many requests wait, and leaves the rules unchecked", () => {
    const [espn, , rules] = healthWords(
      {
        ...ALL_WELL,
        espn: { state: "credentials_rejected", since: t, checkedAt: t },
        blockedCount: 2,
      },
      reading
    ).checks;
    expect(espn).toEqual({
      name: "ESPN",
      mark: "bad",
      state: "Access refused",
      when: "Mon 8:10 PM PT",
      detail:
        'Renew the ESPN cookie on the host. 2 requests are blocked; their managers see "delayed".',
    });
    expect(rules).toEqual({
      name: "League rules",
      mark: "off",
      state: "Not checked",
      when: "last matched Mon 8:10 PM PT",
    });
  });

  it("says ESPN can't be reached, isn't connected, or hasn't been checked", () => {
    const espnOf = (espn: QueueHealth["espn"]) =>
      healthWords({ ...ALL_WELL, espn }, reading).checks[0];
    expect(espnOf({ state: "unreachable", since: t, checkedAt: t })).toEqual({
      name: "ESPN",
      mark: "bad",
      state: "Can't be reached",
      when: "Mon 8:10 PM PT",
      detail: "Requests wait and re-check ESPN before sending.",
    });
    expect(espnOf({ state: "not_connected", since: t, checkedAt: t })).toEqual({
      name: "ESPN",
      mark: "off",
      state: "Not connected",
      detail: "No ESPN cookie on the host yet. Every request comes to you.",
    });
    expect(espnOf(null)).toEqual({ name: "ESPN", mark: "off", state: "Not checked yet" });
  });

  it("tells the swap runner's outage apart from ESPN's", () => {
    const [espn, worker] = healthWords(
      { ...ALL_WELL, worker: { lastBeatAt: t, down: true } },
      reading
    ).checks;
    expect(espn?.mark).toBe("ok");
    expect(worker).toEqual({
      name: "Swap runner",
      mark: "bad",
      state: "Not running",
      when: "last seen Mon 8:10 PM PT",
      detail: "Requests in line show as not started. Nothing is sent until it's back.",
    });
  });

  it("names each rule that differs", () => {
    const [, , rules] = healthWords(
      {
        ...ALL_WELL,
        rules: {
          checkedAt: t,
          lastMatchedAt: null,
          mismatches: [
            { kind: "setting", setting: "Steals points", expected: "3", espn: "2" },
            {
              kind: "day-points",
              teamId: 4,
              playerId: 9,
              name: "Invented Player",
              scoringPeriodId: 27,
              formulaPoints: 31.5,
              espnPoints: 30,
            },
          ],
        },
      },
      reading
    ).checks;
    expect(rules).toEqual({
      name: "League rules",
      mark: "warn",
      state: "2 differ",
      when: "Mon 8:10 PM PT",
      detail:
        "Steals points: ESPN has 2, InjurySub expects 3. Invented Player: ESPN scored 30, InjurySub's formula gives 31.5. Adjustments wait for you.",
    });
  });

  it("says the misuse watch is paused, or hasn't started", () => {
    const watchOf = (watch: QueueHealth["watch"]) =>
      healthWords({ ...ALL_WELL, watch }, reading).separate;
    expect(watchOf({ state: "paused", reason: "unreachable", since: t, checkedAt: t })).toEqual({
      name: "Misuse watch",
      mark: "bad",
      state: "Paused",
      when: "Mon 8:10 PM PT",
      detail: "Can't read ESPN's log, so nothing is being checked. You were emailed.",
      href: "/commish/alerts",
    });
    expect(watchOf({ state: "not_started" })).toEqual({
      name: "Misuse watch",
      mark: "off",
      state: "Not started",
      href: "/commish/alerts",
    });
  });
});
