import { describe, expect, it } from "vitest";
import { restoreSideText } from "./proving-text";

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
