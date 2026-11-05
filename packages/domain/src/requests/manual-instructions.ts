import { composeReason, targetSideAdjustment } from "../adjustment/ledger";
import type { LineupMove, PlaceableOption } from "../lineup/classify-options";

export type AdjustmentInstruction =
  | { enterTenths: number; reason: string }
  | { enterTenths: number; reason: null; reasonTooLong: true };

export type ManualInstructions = {
  lineupMoves: LineupMove[];
  adjustment: AdjustmentInstruction | null;
};

// The lineup edit for an option: the injured starter to the bench, any other starters' moves, and
// the replacement from the bench into the slot the option leaves him.
export function lineupMovesFor(
  injured: { playerId: number; slot: string },
  option: PlaceableOption
): LineupMove[] {
  const landing = option.lineup.find(({ playerId }) => playerId === option.playerId);
  if (landing === undefined)
    throw new RangeError("The option's lineup doesn't hold its replacement.");
  return [
    { playerId: injured.playerId, fromSlot: injured.slot, toSlot: "BE" },
    ...option.moves,
    { playerId: option.playerId, fromSlot: "BE", toSlot: landing.slot },
  ];
}

// What the commissioner does by hand: whatever is still left. A lineup already on ESPN needs no
// moves; an adjustment of zero needs no entry. The value to enter is the side's new total, its
// existing adjustment included.
export function buildManualInstructions(input: {
  lineupMoves: LineupMove[];
  lineupDone: boolean;
  side: { currentTenths: number; currentReason: string };
  deltaTenths: number;
  reasonEntry: string;
  reasonMaxLength: number;
}): ManualInstructions {
  const lineupMoves = input.lineupDone ? [] : input.lineupMoves;
  if (input.deltaTenths === 0) return { lineupMoves, adjustment: null };

  const enterTenths = targetSideAdjustment(input.side.currentTenths, input.deltaTenths);
  const composed = composeReason(
    input.side.currentReason,
    input.reasonEntry,
    input.reasonMaxLength
  );
  const adjustment: AdjustmentInstruction = composed.ok
    ? { enterTenths, reason: composed.reason }
    : { enterTenths, reason: null, reasonTooLong: true };
  return { lineupMoves, adjustment };
}
