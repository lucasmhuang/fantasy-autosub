import { describe, expect, it } from "vitest";
import type { PlaceableOption } from "../lineup/classify-options";
import { buildManualInstructions, lineupMovesFor } from "./manual-instructions";

const direct: PlaceableOption = {
  playerId: 20,
  kind: "direct",
  moves: [],
  lineup: [
    { slot: "G", playerId: 1 },
    { slot: "F", playerId: 20 },
  ],
};

const rearrangement: PlaceableOption = {
  playerId: 20,
  kind: "rearrangement",
  moves: [{ playerId: 9, fromSlot: "UTIL", toSlot: "G" }],
  lineup: [
    { slot: "G", playerId: 9 },
    { slot: "UTIL", playerId: 20 },
  ],
};

const side = { currentTenths: 51, currentReason: "Sub A +5.1" };

describe("lineupMovesFor", () => {
  it("benches the injured starter and starts the replacement in his slot for a direct swap", () => {
    expect(lineupMovesFor({ playerId: 2, slot: "F" }, direct)).toEqual([
      { playerId: 2, fromSlot: "F", toSlot: "BE" },
      { playerId: 20, fromSlot: "BE", toSlot: "F" },
    ]);
  });

  it("adds the other starters' moves for a rearrangement", () => {
    expect(lineupMovesFor({ playerId: 2, slot: "G" }, rearrangement)).toEqual([
      { playerId: 2, fromSlot: "G", toSlot: "BE" },
      { playerId: 9, fromSlot: "UTIL", toSlot: "G" },
      { playerId: 20, fromSlot: "BE", toSlot: "UTIL" },
    ]);
  });
});

describe("buildManualInstructions", () => {
  it("lists the lineup moves and the value to enter, which includes the matchup's existing adjustment", () => {
    const instructions = buildManualInstructions({
      lineupMoves: lineupMovesFor({ playerId: 2, slot: "F" }, direct),
      lineupDone: false,
      side,
      deltaTenths: -30,
      reasonEntry: "Sub B -3.0",
      reasonMaxLength: 100,
    });

    expect(instructions).toEqual({
      lineupMoves: [
        { playerId: 2, fromSlot: "F", toSlot: "BE" },
        { playerId: 20, fromSlot: "BE", toSlot: "F" },
      ],
      adjustment: { enterTenths: 21, reason: "Sub A +5.1 | Sub B -3.0" },
    });
  });

  it("lists only the adjustment once the lineup is already on ESPN", () => {
    const instructions = buildManualInstructions({
      lineupMoves: lineupMovesFor({ playerId: 2, slot: "F" }, direct),
      lineupDone: true,
      side,
      deltaTenths: -30,
      reasonEntry: "Sub B -3.0",
      reasonMaxLength: 100,
    });

    expect(instructions.lineupMoves).toEqual([]);
    expect(instructions.adjustment).toEqual({ enterTenths: 21, reason: "Sub A +5.1 | Sub B -3.0" });
  });

  it("asks for no adjustment when none is owed", () => {
    const instructions = buildManualInstructions({
      lineupMoves: [],
      lineupDone: true,
      side,
      deltaTenths: 0,
      reasonEntry: "Sub B 0.0",
      reasonMaxLength: 100,
    });

    expect(instructions).toEqual({ lineupMoves: [], adjustment: null });
  });

  it("says when the reason won't fit ESPN's limit, still giving the value to enter", () => {
    const instructions = buildManualInstructions({
      lineupMoves: [],
      lineupDone: true,
      side,
      deltaTenths: -30,
      reasonEntry: "Sub B -3.0",
      reasonMaxLength: 12,
    });

    expect(instructions.adjustment).toEqual({ enterTenths: 21, reason: null, reasonTooLong: true });
  });
});
