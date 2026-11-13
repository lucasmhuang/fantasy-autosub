import type { LineupMove } from "../lineup/classify-options";

// One day of a team's lineup as read back from ESPN: each player's slot that day.
export type ReadBackDay = {
  scoringPeriodId: number;
  players: readonly { playerId: number; slot: string }[];
};

export type ReadBackDayState = "applied" | "untouched" | "partial";

// Each of the edit's players' slot that day, by player id; null when he isn't on the roster.
export type ReadBackDayReading = {
  scoringPeriodId: number;
  state: ReadBackDayState;
  slots: Record<number, string | null>;
};

export type LineupReadback =
  | { outcome: "applied"; effectiveDay: number; days: ReadBackDayReading[] }
  | { outcome: "not_applied" | "ambiguous"; days: ReadBackDayReading[] };

function stateOf(
  items: readonly LineupMove[],
  slots: Record<number, string | null>
): ReadBackDayState {
  if (items.every((move) => slots[move.playerId] === move.toSlot)) return "applied";
  if (items.every((move) => slots[move.playerId] === move.fromSlot)) return "untouched";
  return "partial";
}

function readingOf(items: readonly LineupMove[], day: ReadBackDay): ReadBackDayReading {
  const slotOf = (playerId: number) =>
    day.players.find((player) => player.playerId === playerId)?.slot ?? null;
  const slots = Object.fromEntries(items.map(({ playerId }) => [playerId, slotOf(playerId)]));
  return { scoringPeriodId: day.scoringPeriodId, state: stateOf(items, slots), slots };
}

// What ESPN shows of a lineup edit, day by day from the day it was sent through the matchup's
// last day (X10, X13, X14, X23). Applied: every player of the edit in his new slot on each day
// from the effective day on, and in his old one before it, so a day change while the edit was on
// its way still reads as applied, from the next day. Not applied: every player in his old slot on
// every day. Anything else (part of the edit on some day, a player gone, an edit that shows and
// then doesn't) is ambiguous, for the commissioner.
export function readBackLineupEdit(input: {
  items: readonly LineupMove[];
  days: readonly ReadBackDay[];
}): LineupReadback {
  if (input.days.length === 0) throw new RangeError("A lineup readback needs at least one day");
  const days = [...input.days]
    .sort((a, b) => a.scoringPeriodId - b.scoringPeriodId)
    .map((day) => readingOf(input.items, day));
  const first = days.findIndex(({ state }) => state === "applied");
  if (first === -1) {
    const untouched = days.every(({ state }) => state === "untouched");
    return { outcome: untouched ? "not_applied" : "ambiguous", days };
  }
  const before = days.slice(0, first).every(({ state }) => state === "untouched");
  const after = days.slice(first).every(({ state }) => state === "applied");
  const effectiveDay = days[first]?.scoringPeriodId;
  if (!before || !after || effectiveDay === undefined) return { outcome: "ambiguous", days };
  return { outcome: "applied", effectiveDay, days };
}
