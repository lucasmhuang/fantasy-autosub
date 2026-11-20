import type { ReviewReason } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import type { QueueAlert, QueueHealth, QueueRequest, ReviewFacts } from "../../lib/server/queue";
import { alertRowWords, healthWords, requestRowWords } from "./queue-copy";

const reading = { zone: "America/Los_Angeles", now: new Date("2026-11-17T05:00:00.000Z") };
// 8:10 PM PT, as every row reads it.
const t = new Date("2026-11-17T04:10:00.000Z");
const NO_FACTS: ReviewFacts = {
  reviewedAt: null,
  otherMoves: [],
  sentTenths: null,
  approvedTenths: null,
  heldTenths: null,
  mismatches: [],
  offIr: [],
  espnAnswer: null,
};

function request(overrides: Partial<QueueRequest> = {}): QueueRequest {
  return {
    kind: "request",
    requestId: "r1",
    teamId: 4,
    teamName: "Stretch Fours",
    managerName: null,
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
      when: "8:10 PM PT",
      amount: "−31.0 proj.",
    });
  });

  it("calls a team ESPN's name wasn't read for by its number", () => {
    expect(requestRowWords(request({ teamName: null }), reading).team).toBe("Team 4");
  });

  // FS-APP-14 (D8-1): a request is about a person, so its row names the team's manager too.
  it("names the team's manager by first name beside the team", () => {
    expect(requestRowWords(request({ managerName: "Marcus Smith" }), reading)).toMatchObject({
      team: "Stretch Fours",
      manager: "Marcus",
    });
  });

  // Copy table 1, W2: the commissioner's own team reads "you", as Settings and the detail say.
  it("names the commissioner's own team's manager as you", () => {
    expect(
      requestRowWords(request({ managerName: "Lucas Invented" }), { ...reading, ownTeamId: 4 })
        .manager
    ).toBe("you");
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
    expect(status("completed_manually")).toEqual({ kind: "done", word: "Settled by hand" });
    expect(status("queued")).toEqual({ kind: "in-line", word: "In line" });
    expect(status("rejected")).toEqual({ kind: "stopped", word: "Rejected" });
  });

  it("says when an approval expires", () => {
    const words = requestRowWords(
      request({ status: "awaiting_approval", reviewReason: null, expiresAt: t }),
      reading
    );
    expect(words.needs).toEqual({ reason: "Approval", sentence: "Expires 8:10 PM PT." });
  });

  it("gives an approval with no expiry no sentence, the pill saying it", () => {
    const words = requestRowWords(
      request({ status: "awaiting_approval", reviewReason: null, expiresAt: null }),
      reading
    );
    expect(words.needs).toEqual({ reason: "Approval" });
  });

  it("says the cookie refusal with no blocked count, and where to renew it", () => {
    const [espn] = healthWords(
      { ...ALL_WELL, espn: { state: "credentials_rejected", since: t, checkedAt: t } },
      reading
    ).checks;
    expect(espn?.detail).toMatch(/Railway.*Delayed/);
    expect(espn?.detail).not.toMatch(/blocked/);
  });

  it("gives the reasons whose pill says it all no sentence", () => {
    expect(reasonOf("automation_off")).toEqual({ reason: "Automation off" });
    expect(reasonOf("not_allowlisted")).toEqual({ reason: "Not ticked" });
    expect(reasonOf("playoffs")).toEqual({ reason: "Playoffs" });
  });

  it("names the moved starters, the suspended starter and when ESPN refused the lineup", () => {
    const moves = reasonOf("rearrangement", {
      otherMoves: [
        { name: "Lauri Markkanen", toSlot: "F/C" },
        { name: "Bam Adebayo", toSlot: "BE" },
      ],
    });
    expect(moves?.reason).toBe("Rearrangement");
    expect(moves?.sentence).toContain("Markkanen to F/C, Adebayo to BN");
    expect(reasonOf("suspension")?.sentence).toContain("Sabonis");
    expect(reasonOf("stale")?.reason).toBe("Lineup changed");
    expect(reasonOf("ambiguous")?.reason).toBe("Check ESPN");
    expect(reasonOf("lineup_failed", { reviewedAt: t })?.sentence).toContain("8:10 PM PT");
    expect(
      reasonOf("lineup_failed", {
        reviewedAt: t,
        espnAnswer: "HTTP 409 TRAN_ROSTER_LIMIT_EXCEEDED_ONE",
      })?.sentence
    ).toContain("(HTTP 409 TRAN_ROSTER_LIMIT_EXCEEDED_ONE)");
  });

  it("gives each adjustment reason the amounts and rules it names", () => {
    expect(reasonOf("adjustment_failed", { sentTenths: -194 })?.sentence).toContain("−19.4");
    const held = reasonOf("adjustment_held_rules", {
      mismatches: [{ kind: "setting", setting: "Steals points", expected: "3", espn: "2" }],
    });
    expect(held?.reason).toBe("Adjustment held");
    expect(held?.sentence).toContain("Steals points is 2 on ESPN; InjurySub expects 3");
    const changed = reasonOf("adjustment_changed", { approvedTenths: -821, heldTenths: -878 });
    expect(changed?.reason).toBe("Adjustment changed");
    expect(changed?.sentence).toContain("−82.1");
    expect(changed?.sentence).toContain("−87.8");
  });

  it("gives the reasons a sweep or the calendar sets their facts, and no instruction", () => {
    const expired = reasonOf("expired")?.sentence;
    expect(expired).toContain("12 hours");
    expect(expired).toContain("8:10 PM PT");
    expect(reasonOf("week_ended")?.sentence).toContain("Week 4");
    expect(reasonOf("week_ended")?.sentence).not.toMatch(/post the adjustment/);
  });

  it("names who comes off IR and the week after the request's when next week is full", () => {
    const full = reasonOf("next_week_full", { offIr: ["Jonas Valančiūnas"] });
    expect(full?.reason).toBe("Next week full");
    expect(full?.sentence).toContain("Valančiūnas is on IR from week 5");
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

  it("reads Misuse watch and the alert's title, listing no buttons", () => {
    expect(alertRowWords(alert({}), reading)).toEqual({
      team: "Misuse watch",
      swap: "Lineup change on Backdoor Cutters",
      when: "8:10 PM PT",
      amount: "—",
      needs: { reason: "Alert" },
    });
  });

  it("sums up each kind of alert", () => {
    const summary = (overrides: Partial<QueueAlert>) =>
      alertRowWords(alert(overrides), reading).swap;
    expect(summary({ alertKind: "lm_adjustment", teamName: null })).toBe("Adjustment on Team 4");
    expect(summary({ alertKind: "lm_league_change", teamId: null, teamName: null })).toBe(
      "League settings changed"
    );
    expect(summary({ alertKind: "league_public", teamId: null })).toBe("The league is public");
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
    expect(words.summaryWhen).toBe("8:10 PM PT");
    expect(words.separate).toEqual({
      name: "Misuse watch",
      mark: "ok",
      state: "Watching",
      when: "checked 8:10 PM PT",
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
      state: "Cookie refused",
      when: "8:10 PM PT",
      detail: expect.stringMatching(/Railway.*2 blocked.*Delayed/),
    });
    expect(rules).toEqual({
      name: "League rules",
      mark: "off",
      state: "Not checked",
      when: "last matched 8:10 PM PT",
    });
  });

  it("says ESPN can't be reached, isn't connected, or hasn't been checked", () => {
    const espnOf = (espn: QueueHealth["espn"]) =>
      healthWords({ ...ALL_WELL, espn }, reading).checks[0];
    expect(espnOf({ state: "unreachable", since: t, checkedAt: t })).toEqual({
      name: "ESPN",
      mark: "bad",
      state: "Can't be reached",
      when: "8:10 PM PT",
      detail: "Requests wait.",
    });
    expect(espnOf({ state: "not_connected", since: t, checkedAt: t })).toEqual({
      name: "ESPN",
      mark: "off",
      state: "No cookie",
      detail: "No ESPN cookie yet; every request goes to Needs you.",
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
      name: "InjurySub",
      mark: "bad",
      state: "Not running",
      when: "last seen 8:10 PM PT",
      detail: expect.stringMatching(/Nothing is sent until it's back.*Not started/),
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
      when: "8:10 PM PT",
      detail:
        "Steals points is 2 on ESPN; InjurySub expects 3. Invented Player scored 30 on ESPN; InjurySub's formula gives 31.5. Adjustments wait for you.",
    });
  });

  it("says the misuse watch is paused, or hasn't started", () => {
    const watchOf = (watch: QueueHealth["watch"]) =>
      healthWords({ ...ALL_WELL, watch }, reading).separate;
    expect(watchOf({ state: "paused", reason: "unreachable", since: t, checkedAt: t })).toEqual({
      name: "Misuse watch",
      mark: "bad",
      state: "Paused",
      when: "8:10 PM PT",
      detail: "ESPN couldn't be reached",
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
