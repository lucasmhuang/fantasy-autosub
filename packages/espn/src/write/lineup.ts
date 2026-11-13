import { lineupSlotNames } from "../read/contracts";
import type { LineupTransactionBody, LineupWriteMove } from "./contracts";

// An ESPN member id (the owner's SWID), with or without its braces.
const MEMBER_ID =
  /^(?:\{([0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12})\}|([0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}))$/;

function slotIdOf(slot: string): number {
  const slotId = (lineupSlotNames as readonly string[]).indexOf(slot);
  if (slotId === -1) throw new RangeError(`ESPN has no lineup slot named ${slot}`);
  return slotId;
}

// ESPN takes the member id in braces, as the SWID cookie carries it. The message never names it.
function bracedMemberId(memberId: string): string {
  const match = MEMBER_ID.exec(memberId);
  const id = match?.[1] ?? match?.[2];
  if (id === undefined) throw new RangeError("The owner's member id isn't an ESPN member id");
  return `{${id}}`;
}

// The league-manager lineup edit ESPN applied on 2026-10-29, for any number of moves. The items
// keep the order given: lineupMovesFor's, where each move's target slot is free once the moves
// before it have applied.
export function buildLineupTransaction(input: {
  teamId: number;
  memberId: string;
  scoringPeriodId: number;
  moves: readonly LineupWriteMove[];
}): LineupTransactionBody {
  if (input.moves.length === 0) throw new RangeError("A lineup edit needs at least one move");
  return {
    isLeagueManager: true,
    teamId: input.teamId,
    type: "ROSTER",
    memberId: bracedMemberId(input.memberId),
    scoringPeriodId: input.scoringPeriodId,
    executionType: "EXECUTE",
    items: input.moves.map((move) => ({
      playerId: move.playerId,
      type: "LINEUP",
      fromLineupSlotId: slotIdOf(move.fromSlot),
      toLineupSlotId: slotIdOf(move.toSlot),
    })),
    isActingAsTeamOwner: false,
    skipTransactionCounters: false,
  };
}
