import { describe, expect, it } from "vitest";
import { lineup, player } from "../lineup/test-lineups";
import { isAutomatableEdit, planLineupEdit } from "./lineup-edit";

describe("planLineupEdit", () => {
  it("plans a direct swap as two items, with no other starter moving", () => {
    const edit = planLineupEdit({
      lineup: lineup([player(20, "sf")]),
      injuredPlayerId: 4,
      replacementPlayerId: 20,
    });

    expect(edit).toEqual({
      items: [
        { playerId: 4, fromSlot: "F", toSlot: "BE" },
        { playerId: 20, fromSlot: "BE", toSlot: "F" },
      ],
      movedStarters: 0,
    });
  });

  it("plans a one-move rearrangement as three items, in the order they're sent", () => {
    // A power forward can't play C: the UTIL center moves to C, and he takes the UTIL.
    const edit = planLineupEdit({
      lineup: lineup([player(20, "pf")]),
      injuredPlayerId: 7,
      replacementPlayerId: 20,
    });

    expect(edit).toEqual({
      items: [
        { playerId: 7, fromSlot: "C", toSlot: "BE" },
        { playerId: 10, fromSlot: "UTIL", toSlot: "C" },
        { playerId: 20, fromSlot: "BE", toSlot: "UTIL" },
      ],
      movedStarters: 1,
    });
  });

  it("plans a replacement who takes an open starting slot as two items, with nobody moving", () => {
    // A center can't play F, but the second UTIL is empty.
    const edit = planLineupEdit({
      lineup: lineup([player(20, "c")], { 10: null }),
      injuredPlayerId: 4,
      replacementPlayerId: 20,
    });

    expect(edit).toEqual({
      items: [
        { playerId: 4, fromSlot: "F", toSlot: "BE" },
        { playerId: 20, fromSlot: "BE", toSlot: "UTIL" },
      ],
      movedStarters: 0,
    });
  });

  it("has no plan when the starter isn't starting, the replacement isn't on the bench, or nothing fits", () => {
    const benchOnly = { playerId: 21, eligibleSlots: ["BE", "IR"] };
    const input = lineup([player(20, "sf"), benchOnly]);

    expect(planLineupEdit({ lineup: input, injuredPlayerId: 99, replacementPlayerId: 20 })).toBe(
      null
    );
    expect(planLineupEdit({ lineup: input, injuredPlayerId: 4, replacementPlayerId: 1 })).toBe(
      null
    );
    expect(planLineupEdit({ lineup: input, injuredPlayerId: 4, replacementPlayerId: 21 })).toBe(
      null
    );
  });
});

describe("isAutomatableEdit", () => {
  it("automates an edit moving at most one other starter, an open slot's included", () => {
    const items = [{ playerId: 4, fromSlot: "F", toSlot: "BE" }];

    expect(isAutomatableEdit({ items, movedStarters: 0 })).toBe(true);
    expect(isAutomatableEdit({ items, movedStarters: 1 })).toBe(true);
    expect(isAutomatableEdit({ items, movedStarters: 2 })).toBe(false);
  });

  it("leaves a two-move rearrangement to the commissioner", () => {
    // A point guard fits only once the UTIL forward moves to F/C and its forward-center to C.
    const edit = planLineupEdit({
      lineup: lineup([player(20, "pg")], { 8: player(8, "fc"), 10: player(10, "sf") }),
      injuredPlayerId: 7,
      replacementPlayerId: 20,
    });

    expect(edit?.movedStarters).toBe(2);
    expect(edit && isAutomatableEdit(edit)).toBe(false);
  });
});
