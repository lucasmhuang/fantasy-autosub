import { describe, expect, it } from "vitest";
import { reviewReasons } from "./lifecycle";
import {
  commissionerReasonFact,
  managerReasonSentence,
  REASON_PILLS,
  type ReasonFacts,
  ruleMismatchWords,
} from "./reason-copy";

const facts: ReasonFacts = { starter: "Lillard", week: 4 };

describe("REASON_PILLS", () => {
  it("names every reason, ticked teams and the adjustment in the glossary's words", () => {
    expect(Object.keys(REASON_PILLS).sort()).toEqual([...reviewReasons].sort());
    expect(REASON_PILLS.not_allowlisted).toBe("Not ticked");
    expect(REASON_PILLS.adjustment_changed).toBe("Adjustment changed");
    expect(REASON_PILLS.next_week_full).toBe("Next week full");
  });
});

describe("commissionerReasonFact", () => {
  it("leaves the reasons whose pill says it all without a sentence", () => {
    for (const reason of ["automation_off", "not_allowlisted", "playoffs"] as const) {
      expect(commissionerReasonFact(reason, facts)).toBeNull();
    }
  });

  it("names the suspended starter", () => {
    expect(commissionerReasonFact("suspension", facts)).toContain("Lillard is suspended");
  });

  it("counts and lists the other starters a rearrangement moves, the bench as BN", () => {
    const sentence = commissionerReasonFact("rearrangement", {
      ...facts,
      moves: [
        { name: "Reid", slot: "C" },
        { name: "Toppin", slot: "BE" },
      ],
    });
    expect(sentence).toMatch(/^Two other starters/);
    expect(sentence).toContain("Reid to C, Toppin to BN");
  });

  it("names who comes off IR next week, and that week, when next week's roster is full", () => {
    const fact = commissionerReasonFact("next_week_full", { ...facts, offIr: ["Kuminga"] });

    expect(fact).toContain("Kuminga is on IR from week 5");
    expect(fact).toContain("roster is full");
    expect(commissionerReasonFact("next_week_full", facts)).toContain("Lillard is on IR");
    expect(
      commissionerReasonFact("next_week_full", { ...facts, offIr: ["Kuminga", "Yaxel"] })
    ).toContain("Kuminga and Yaxel are on IR");
  });

  it("gives the time ESPN refused the lineup change, when it's known", () => {
    expect(commissionerReasonFact("lineup_failed", { ...facts, at: "9:14 PM PT" })).toContain(
      "at 9:14 PM PT"
    );
    expect(commissionerReasonFact("lineup_failed", facts)).not.toContain(" at ");
  });

  it("names the refused adjustment and both amounts of a changed one", () => {
    expect(commissionerReasonFact("adjustment_failed", { ...facts, sent: "−22.6" })).toContain(
      "−22.6"
    );
    const changed = commissionerReasonFact("adjustment_changed", {
      ...facts,
      approved: "−18.0",
      held: "−22.6",
    });
    expect(changed).toContain("−18.0");
    expect(changed).toContain("−22.6");
  });

  it("gives the first differing rule and how many more", () => {
    const held = commissionerReasonFact("adjustment_held_rules", {
      ...facts,
      mismatch: { first: "Lineup lock is daily on ESPN; InjurySub expects weekly", more: 2 },
    });
    expect(held).toContain("Lineup lock is daily on ESPN");
    expect(held).toContain("and 2 more");
  });

  it("gives the hours waited, the filing time and the week that ended", () => {
    const expired = commissionerReasonFact("expired", { ...facts, hours: 12, filed: "Mon 9 PM" });
    expect(expired).toContain("12 hours");
    expect(expired).toContain("Mon 9 PM");
    expect(commissionerReasonFact("week_ended", facts)).toContain("Week 4");
  });

  it("explains nothing InjurySub does next and lists no buttons", () => {
    for (const reason of reviewReasons) {
      expect(commissionerReasonFact(reason, facts) ?? "").not.toMatch(
        /approv|re-check|by hand|come to you|post the adjustment/i
      );
    }
  });
});

describe("managerReasonSentence", () => {
  const words = { commissioner: "Sam", starter: "Lillard", week: 4 };

  it("says the commissioner settles it, by first name, in the glossary's words", () => {
    for (const reason of ["automation_off", "not_allowlisted", "rearrangement"] as const) {
      expect(managerReasonSentence(reason, words)).toContain("Sam settles");
    }
    expect(managerReasonSentence("playoffs", words)).toContain("Sam settles every request");
  });

  it("never claims a number of starters it doesn't know", () => {
    expect(managerReasonSentence("rearrangement", words)).not.toMatch(/\b(Two|Three)\b/);
  });

  it("tells the manager next week is full and that the commissioner approves once a spot opens", () => {
    const sentence = managerReasonSentence("next_week_full", words);

    expect(sentence).toContain("Lillard is on IR from next week");
    expect(sentence).toContain("roster is full");
    expect(sentence).toContain("Sam approves");
  });

  it("names the suspended starter and the week that ended", () => {
    expect(managerReasonSentence("suspension", words)).toContain("Lillard is suspended");
    expect(managerReasonSentence("week_ended", words)).toContain("Week 4");
  });

  it("leaves who acts next to the panel's other slots", () => {
    for (const reason of ["stale", "ambiguous", "lineup_failed", "adjustment_failed"] as const) {
      expect(managerReasonSentence(reason, words)).not.toContain("Sam");
    }
  });
});

describe("ruleMismatchWords", () => {
  it("words a setting and a day's points one way everywhere", () => {
    expect(
      ruleMismatchWords({
        kind: "setting",
        setting: "Lineup lock",
        espn: "daily",
        expected: "weekly",
      })
    ).toBe("Lineup lock is daily on ESPN; InjurySub expects weekly");
    expect(
      ruleMismatchWords({ kind: "day-points", name: "Tatum", espnPoints: 41, formulaPoints: 40.5 })
    ).toBe("Tatum scored 41 on ESPN; InjurySub's formula gives 40.5");
  });
});
