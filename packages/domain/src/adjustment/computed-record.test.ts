import { describe, expect, it } from "vitest";
import type { AdjustmentLine } from "./compute";
import { computedLinesOf, computedRecord } from "./computed-record";

const lines: AdjustmentLine[] = [
  { day: 7, playerId: 11, tenths: -404, why: "injured_credited_before_swap" },
  { day: 7, playerId: 12, tenths: 213, why: "replacement_after_request" },
];

describe("the lines kept with a computed adjustment", () => {
  it("reads back the lines a snapshot was written with, beside whatever else it holds", () => {
    const payload = { matchup: { matchupId: 12 }, ...computedRecord(lines) };

    expect(computedLinesOf(payload)).toEqual(lines);
  });

  it("finds none in a snapshot that kept no computation", () => {
    expect(computedLinesOf({ matchup: { matchupId: 12 } })).toBeNull();
  });

  it("finds none when a line gives a reason the adjustment never writes", () => {
    const invented = { day: 7, playerId: 11, tenths: 1, why: "invented" };

    expect(computedLinesOf({ computed: { lines: [invented] } })).toBeNull();
  });
});
