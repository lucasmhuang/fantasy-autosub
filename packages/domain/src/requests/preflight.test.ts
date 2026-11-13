import { describe, expect, it } from "vitest";
import { lineup, player } from "../lineup/test-lineups";
import { acceptedDesignationOf, checkPlanStillHolds } from "./preflight";

describe("acceptedDesignationOf", () => {
  it("takes ESPN's designation at the request, or at filing for an on-behalf request", () => {
    expect(
      acceptedDesignationOf({
        kind: "substitution",
        designationAtRequest: "SUSPENSION",
        designationAtFiling: null,
      })
    ).toBe("SUSPENSION");
    expect(
      acceptedDesignationOf({
        kind: "on_behalf",
        designationAtRequest: "OUT",
        designationAtFiling: "ACTIVE",
      })
    ).toBe("ACTIVE");
    expect(() =>
      acceptedDesignationOf({
        kind: "on_behalf",
        designationAtRequest: "OUT",
        designationAtFiling: null,
      })
    ).toThrow(RangeError);
  });
});

describe("checkPlanStillHolds", () => {
  const swap = { lineup: lineup([player(20, "sf")]), injuredPlayerId: 4, replacementPlayerId: 20 };

  it("holds while the designation is the accepted one and an automatable edit fits", () => {
    for (const designation of ["OUT", "SUSPENSION", "ACTIVE"]) {
      const check = checkPlanStillHolds({
        ...swap,
        acceptedDesignation: designation,
        currentDesignation: designation,
      });

      expect(check).toEqual({
        ok: true,
        edit: {
          items: [
            { playerId: 4, fromSlot: "F", toSlot: "BE" },
            { playerId: 20, fromSlot: "BE", toSlot: "F" },
          ],
          movedStarters: 0,
        },
      });
    }
  });

  it("goes stale once the designation differs from the accepted one", () => {
    const check = checkPlanStillHolds({
      ...swap,
      acceptedDesignation: "OUT",
      currentDesignation: "DAY_TO_DAY",
    });

    expect(check).toEqual({ ok: false, detail: "designation_changed" });
  });

  it("goes stale once no automatable edit fits: the replacement left the bench, or two would move", () => {
    const designations = { acceptedDesignation: "OUT", currentDesignation: "OUT" };
    const replacementStarting = lineup([], { 6: player(20, "sf") });
    const twoMoves = lineup([player(20, "pg")], { 8: player(8, "fc"), 10: player(10, "sf") });

    expect(checkPlanStillHolds({ ...swap, ...designations, lineup: replacementStarting })).toEqual({
      ok: false,
      detail: "no_automatable_edit",
    });
    expect(
      checkPlanStillHolds({
        lineup: twoMoves,
        injuredPlayerId: 7,
        replacementPlayerId: 20,
        ...designations,
      })
    ).toEqual({ ok: false, detail: "no_automatable_edit" });
  });
});
