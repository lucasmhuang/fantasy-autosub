import {
  type ClassifiableLineup,
  classifyReplacementOptions,
  type LineupMove,
} from "../lineup/classify-options";
import { lineupMovesFor } from "./manual-instructions";

// The lineup edit that puts a replacement in for an injured starter: every move, in the order
// sent (the starter to the bench, any other starter's move, the replacement from the bench), and
// how many other starters move.
export type LineupEdit = { items: LineupMove[]; movedStarters: number };

// The one place the edit is worked out, for the board, routing, Confirm, the commissioner's page
// and the executor alike (AC3-3): the fewest-moves option for that replacement, or null when the
// starter isn't starting, the replacement isn't on the bench, or no starting slot can take him.
export function planLineupEdit(input: {
  lineup: ClassifiableLineup;
  injuredPlayerId: number;
  replacementPlayerId: number;
}): LineupEdit | null {
  const result = classifyReplacementOptions({
    lineup: input.lineup,
    injuredPlayerId: input.injuredPlayerId,
  });
  if (!result.ok) return null;
  const option = result.options.find(({ playerId }) => playerId === input.replacementPlayerId);
  const injured = input.lineup.starters.find(
    ({ player }) => player?.playerId === input.injuredPlayerId
  );
  if (option === undefined || option.kind === "invalid" || injured === undefined) return null;
  const items = lineupMovesFor({ playerId: input.injuredPlayerId, slot: injured.slot }, option);
  return { items, movedStarters: option.moves.length };
}

// What the app sends on its own: a direct swap, a replacement taking an open starting slot, or a
// one-move rearrangement (Dec-D28, Dec-D29a). An edit moving two or more starters goes to the
// commissioner.
export function isAutomatableEdit(edit: LineupEdit): boolean {
  return edit.movedStarters <= 1;
}
