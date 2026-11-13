import { describe, expect, it } from "vitest";
import { decideAdjustment } from "./decision";

const base = {
  rulesMatch: true,
  computedTenths: -404,
  approvedComputedTenths: null,
  overrideTenths: null,
};

describe("decideAdjustment", () => {
  it("writes the computed amount when nothing holds it", () => {
    expect(decideAdjustment(base)).toEqual({
      kind: "write",
      finalTenths: -404,
      computedTenths: -404,
    });
  });

  it("holds the adjustment while ESPN's rules differ, even when nothing would be owed (X17)", () => {
    expect(decideAdjustment({ ...base, rulesMatch: false })).toEqual({
      kind: "held",
      reason: "adjustment_held_rules",
      computedTenths: -404,
    });
    expect(decideAdjustment({ ...base, rulesMatch: false, computedTenths: 0 }).kind).toBe("held");
  });

  it("holds for re-approval an amount unlike the one computed at approval (S4)", () => {
    expect(decideAdjustment({ ...base, approvedComputedTenths: -300 })).toEqual({
      kind: "held",
      reason: "adjustment_changed",
      computedTenths: -404,
      approvedComputedTenths: -300,
      overrideTenths: null,
    });
  });

  it("writes the commissioner's override while the computed amount is the one approved", () => {
    expect(decideAdjustment({ ...base, approvedComputedTenths: -404, overrideTenths: 30 })).toEqual(
      { kind: "write", finalTenths: 30, computedTenths: -404 }
    );
  });

  it("holds an override too once the computed amount moved, showing both (AC1-1, AC2-4)", () => {
    expect(
      decideAdjustment({ ...base, approvedComputedTenths: -300, overrideTenths: 30 })
    ).toMatchObject({ kind: "held", reason: "adjustment_changed", overrideTenths: 30 });
  });

  it("owes nothing when the final amount is zero (X12)", () => {
    expect(decideAdjustment({ ...base, computedTenths: 0 })).toEqual({
      kind: "none",
      computedTenths: 0,
    });
  });
});
