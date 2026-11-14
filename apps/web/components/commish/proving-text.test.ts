import { describe, expect, it } from "vitest";
import { notRunText, restoreSideText, stopText } from "./proving-text";

describe("restoreSideText", () => {
  it("names the note to put back on team 1's side", () => {
    expect(restoreSideText({ tenths: -404, reason: "Injury sub: Larsson for Tatum, -40.4" })).toBe(
      "Check team 1’s adjustment on ESPN. If it isn’t -40.4 points with the note “Injury sub: Larsson for Tatum, -40.4”, set it back to that."
    );
  });

  // Owner, 2026-11-14: a side that had no note says so, not an empty quote.
  it("says no note when the side had none", () => {
    expect(restoreSideText({ tenths: 0, reason: "" })).toBe(
      "Check team 1’s adjustment on ESPN. If it isn’t 0.0 points with no note, set it back to that."
    );
  });
});

describe("notRunText", () => {
  it("says why a proving request that never ran is with the commissioner", () => {
    expect(notRunText("lineup_failed")).toBe("Not run: ESPN didn’t take the swap.");
    expect(notRunText("automation_off")).toBe("Not run: automation is off.");
  });

  it("falls back to the commissioner's own summary for any other reason", () => {
    expect(notRunText("adjustment_held_rules")).toBe(
      "Not run: the league's rules differ from InjurySub's, so the adjustment is held."
    );
  });
});

describe("stopText", () => {
  it("names the step a run stopped at and what was found there", () => {
    expect(stopText("token", "not_applied")).toBe(
      "Stopped at the test adjustment: ESPN didn’t show it. Nothing more was sent."
    );
  });

  it("names the step alone for a detail it has no words for", () => {
    expect(stopText("restore", "something_new")).toBe(
      "Stopped at putting the lineup back. Nothing more was sent."
    );
  });

  it("says nothing of a stop the run didn't make itself", () => {
    expect(stopText(null, "not_applied")).toBeNull();
  });
});
