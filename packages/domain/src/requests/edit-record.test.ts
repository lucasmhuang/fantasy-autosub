import { describe, expect, it } from "vitest";
import { lineup, player } from "../lineup/test-lineups";
import {
  claimedEditRecord,
  confirmedPlanOf,
  isSameEdit,
  planRecord,
  sentEditOf,
} from "./edit-record";
import { planLineupEdit } from "./lineup-edit";

// A one-move rearrangement (the UTIL center to C, a power forward into the UTIL), and a direct
// swap for the same injured center.
const oneMove = planLineupEdit({
  lineup: lineup([player(20, "pf")]),
  injuredPlayerId: 7,
  replacementPlayerId: 20,
})!;
const direct = planLineupEdit({
  lineup: lineup([player(20, "c")]),
  injuredPlayerId: 7,
  replacementPlayerId: 20,
})!;

describe("the confirmed plan in a request snapshot", () => {
  it("reads back the edit Confirm recorded", () => {
    expect(confirmedPlanOf({ projection: null, ...planRecord(oneMove) })).toEqual(oneMove.items);
  });

  it("has none for a refusal, or a request filed before plans were recorded", () => {
    expect(confirmedPlanOf(planRecord(null))).toBeNull();
    expect(confirmedPlanOf({ projection: null })).toBeNull();
    expect(confirmedPlanOf(null)).toBeNull();
  });
});

describe("the edit a claim records", () => {
  it("keeps the confirmed edit beside the one sent only when they differ", () => {
    expect(sentEditOf(claimedEditRecord(direct, oneMove.items))).toEqual({
      items: direct.items,
      confirmedItems: oneMove.items,
    });
    expect(claimedEditRecord(oneMove, oneMove.items)).not.toHaveProperty("confirmedItems");
    expect(sentEditOf(claimedEditRecord(oneMove, oneMove.items))).toEqual({
      items: oneMove.items,
      confirmedItems: null,
    });
  });

  it("records nothing beside the edit sent when no plan was confirmed", () => {
    expect(sentEditOf(claimedEditRecord(oneMove, null))).toEqual({
      items: oneMove.items,
      confirmedItems: null,
    });
  });

  it("finds no edit in a claim that resumed at the adjustment", () => {
    expect(sentEditOf({ resumeAt: "adjustment" })).toBeNull();
  });
});

describe("isSameEdit", () => {
  it("compares every move, in order", () => {
    expect(isSameEdit(oneMove.items, [...oneMove.items])).toBe(true);
    expect(isSameEdit(oneMove.items, direct.items)).toBe(false);
    expect(isSameEdit(oneMove.items, [...oneMove.items].reverse())).toBe(false);
    const moverElsewhere = oneMove.items.map((move, index) =>
      index === 1 ? { ...move, toSlot: "F/C" } : move
    );
    expect(isSameEdit(oneMove.items, moverElsewhere)).toBe(false);
  });
});
