import { describe, expect, it } from "vitest";
import { lineup, player } from "../lineup/test-lineups";
import { acceptedDesignationOf, checkPlanStillHolds, nextWeekOverLimit } from "./preflight";

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

// Next week's first day as ESPN reads it: starters, a bench that may run over its slots, and IR.
function nextWeek(slots: { active: number; bench?: number; ir: readonly number[] }) {
  const starters = Array.from({ length: slots.active }, (_, index) => ({
    playerId: 100 + index,
    slot: "F",
  }));
  const bench = Array.from({ length: slots.bench ?? 0 }, (_, index) => ({
    playerId: 200 + index,
    slot: "BE",
  }));
  const ir = slots.ir.map((playerId) => ({ playerId, slot: "IR" }));
  return [...starters, ...bench, ...ir];
}

describe("nextWeekOverLimit", () => {
  it("is over by one when a moved player is on IR next week and the roster there is full", () => {
    const over = nextWeekOverLimit({
      nextWeek: nextWeek({ active: 10, bench: 4, ir: [7, 8] }),
      movedPlayerIds: [7, 300],
      activeLimit: 14,
    });

    expect(over).toEqual({ activeAfter: 15, activeLimit: 14, offIr: [7] });
  });

  it("fits when next week has a free spot for him", () => {
    expect(
      nextWeekOverLimit({
        nextWeek: nextWeek({ active: 10, bench: 3, ir: [7] }),
        movedPlayerIds: [7],
        activeLimit: 14,
      })
    ).toBeNull();
  });

  it("fits when no moved player is on IR next week, however full the roster", () => {
    expect(
      nextWeekOverLimit({
        nextWeek: nextWeek({ active: 10, bench: 4, ir: [8, 9] }),
        movedPlayerIds: [100, 200],
        activeLimit: 14,
      })
    ).toBeNull();
  });

  it("counts every moved player on IR next week", () => {
    expect(
      nextWeekOverLimit({
        nextWeek: nextWeek({ active: 10, bench: 3, ir: [7, 8] }),
        movedPlayerIds: [7, 8],
        activeLimit: 14,
      })
    ).toEqual({ activeAfter: 15, activeLimit: 14, offIr: [7, 8] });
  });

  // The limit counts every player off IR, the bench included, not only starters (a starting slot
  // empty beside a bench of five is still 14 of 14).
  it("counts a bench over its slots as active", () => {
    expect(
      nextWeekOverLimit({
        nextWeek: nextWeek({ active: 9, bench: 5, ir: [7] }),
        movedPlayerIds: [7],
        activeLimit: 14,
      })
    ).toEqual({ activeAfter: 15, activeLimit: 14, offIr: [7] });
  });
});
