import { describe, expect, it } from "vitest";
import type { LineupMove } from "../lineup/classify-options";
import { type ReadBackDay, readBackLineupEdit } from "./lineup-readback";

// A one-move rearrangement: the injured guard (1) to the bench, the UTIL guard (2) to G, the
// bench center (3) into UTIL.
const items: LineupMove[] = [
  { playerId: 1, fromSlot: "G", toSlot: "BE" },
  { playerId: 2, fromSlot: "UTIL", toSlot: "G" },
  { playerId: 3, fromSlot: "BE", toSlot: "UTIL" },
];
const before = { 1: "G", 2: "UTIL", 3: "BE" };
const after = { 1: "BE", 2: "G", 3: "UTIL" };

function day(scoringPeriodId: number, slots: Record<number, string>): ReadBackDay {
  return {
    scoringPeriodId,
    players: Object.entries(slots).map(([playerId, slot]) => ({
      playerId: Number(playerId),
      slot,
    })),
  };
}

const days = (from: number, to: number, slots: Record<number, string>) =>
  Array.from({ length: to - from + 1 }, (_, index) => day(from + index, slots));

describe("readBackLineupEdit", () => {
  it("finds the edit not applied while every day still shows each player in his old slot", () => {
    expect(readBackLineupEdit({ items, days: days(8, 13, before) }).outcome).toBe("not_applied");
  });

  it("finds it applied from the first day read when every day shows each player in his new slot", () => {
    expect(readBackLineupEdit({ items, days: days(8, 13, after) })).toMatchObject({
      outcome: "applied",
      effectiveDay: 8,
    });
  });

  it("takes the effective day from the first day showing the edit, not the first day read", () => {
    const read = [day(8, before), ...days(9, 13, after)];

    expect(readBackLineupEdit({ items, days: read })).toMatchObject({
      outcome: "applied",
      effectiveDay: 9,
    });
  });

  it("finds a day with only part of the edit ambiguous: the moved starter left where he was", () => {
    const read = days(8, 13, { 1: "BE", 2: "UTIL", 3: "UTIL" });

    expect(readBackLineupEdit({ items, days: read }).outcome).toBe("ambiguous");
  });

  it("finds an edit that shows on one day and not on a later one ambiguous", () => {
    const read = [day(8, after), ...days(9, 13, before)];

    expect(readBackLineupEdit({ items, days: read }).outcome).toBe("ambiguous");
  });

  it("finds a day missing one of the edit's players ambiguous", () => {
    const read = [...days(8, 12, after), day(13, { 1: "BE", 3: "UTIL" })];

    expect(readBackLineupEdit({ items, days: read }).outcome).toBe("ambiguous");
  });

  it("reads the days in day order, whatever order they come in", () => {
    const read = [...days(9, 13, after), day(8, before)];

    expect(readBackLineupEdit({ items, days: read })).toMatchObject({ effectiveDay: 9 });
  });

  it("keeps each day's slot for each of the edit's players, a missing one as null", () => {
    const read = [day(8, before), day(9, { 1: "BE", 3: "UTIL" })];

    expect(readBackLineupEdit({ items, days: read }).days).toEqual([
      { scoringPeriodId: 8, state: "untouched", slots: { 1: "G", 2: "UTIL", 3: "BE" } },
      { scoringPeriodId: 9, state: "partial", slots: { 1: "BE", 2: null, 3: "UTIL" } },
    ]);
  });
});
