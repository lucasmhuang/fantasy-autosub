// A player as the lineup lists him: ESPN's slot names he may fill.
export type LineupPlayerRef = { playerId: number; eligibleSlots: readonly string[] };
export type ClassifiableSlot = { slot: string; player: LineupPlayerRef | null };
export type ClassifiableLineup = {
  starters: readonly ClassifiableSlot[];
  bench: readonly ClassifiableSlot[];
  injuredReserve: readonly ClassifiableSlot[];
};

export type LineupMove = { playerId: number; fromSlot: string; toSlot: string };
export type StartingSlot = { slot: string; playerId: number | null };

export type ReplacementOption =
  | {
      playerId: number;
      kind: "direct" | "rearrangement";
      moves: LineupMove[];
      lineup: StartingSlot[];
    }
  | { playerId: number; kind: "invalid"; reason: "no_slot_fits" };

// An option that puts the replacement in the lineup.
export type PlaceableOption = Exclude<ReplacementOption, { kind: "invalid" }>;

// One step of a placement: the player taking a slot, and the slot he leaves (null: the bench).
type ChainStep = { player: LineupPlayerRef; fromIndex: number | null };

export type ReplacementOptionsResult =
  | { ok: true; options: ReplacementOption[] }
  | { ok: false; reason: "injured_not_starting" };

// What each bench player could do for an injured starter. A direct swap puts him in the injured
// starter's slot with no one else moving; a rearrangement fits him only once other starters move
// (the fewest moves, found by a breadth-first augmenting path over the starting slots, each player
// limited to the slots ESPN lists him for); otherwise no starting slot can take him. Empty bench
// slots offer nothing, and IR is never offered.
export function classifyReplacementOptions(input: {
  lineup: ClassifiableLineup;
  injuredPlayerId: number;
}): ReplacementOptionsResult {
  const starters = inVisitOrder(input.lineup.starters);
  const { bench } = input.lineup;
  const injuredIndex = starters.findIndex(
    ({ player }) => player?.playerId === input.injuredPlayerId
  );
  if (injuredIndex === -1) return { ok: false, reason: "injured_not_starting" };

  const occupants = starters.map(({ player }, index) => (index === injuredIndex ? null : player));
  const options = bench.flatMap(({ player }) =>
    player === null ? [] : [optionFor(starters, occupants, injuredIndex, player)]
  );
  return { ok: true, options };
}

function optionFor(
  starters: readonly ClassifiableSlot[],
  occupants: (LineupPlayerRef | null)[],
  injuredIndex: number,
  candidate: LineupPlayerRef
): ReplacementOption {
  const { playerId } = candidate;
  if (canFill(candidate, starters[injuredIndex]!.slot)) {
    const placed = occupants.map((occupant, index) =>
      index === injuredIndex ? candidate : occupant
    );
    return { playerId, kind: "direct", moves: [], lineup: startingSlots(starters, placed) };
  }
  const placed = placeWithFewestMoves(starters, occupants, candidate);
  if (placed === null) return { playerId, kind: "invalid", reason: "no_slot_fits" };
  return {
    playerId,
    kind: "rearrangement",
    moves: movesBetween(starters, occupants, placed, candidate),
    lineup: startingSlots(starters, placed),
  };
}

// The starters as listed, slot by slot, but a slot's occupants by player id (an empty slot last),
// so a lineup gives the same plan whatever order ESPN lists a slot's occupants in (AC3-4).
function inVisitOrder(starters: readonly ClassifiableSlot[]): ClassifiableSlot[] {
  const firstIndex = new Map<string, number>();
  for (const [index, { slot }] of starters.entries()) {
    if (!firstIndex.has(slot)) firstIndex.set(slot, index);
  }
  const idOf = ({ player }: ClassifiableSlot) => player?.playerId ?? Number.MAX_SAFE_INTEGER;
  return [...starters].sort(
    (a, b) => firstIndex.get(a.slot)! - firstIndex.get(b.slot)! || idOf(a) - idOf(b)
  );
}

function canFill(player: LineupPlayerRef, slot: string): boolean {
  return player.eligibleSlots.includes(slot);
}

// Breadth-first from the candidate: each slot he can fill is either open (done) or held by a
// starter who must then move on. Returns the new occupants, or null if no path reaches an open slot.
function placeWithFewestMoves(
  starters: readonly ClassifiableSlot[],
  occupants: (LineupPlayerRef | null)[],
  candidate: LineupPlayerRef
): (LineupPlayerRef | null)[] | null {
  const cameFrom = new Map<number, ChainStep>();
  const queue: ChainStep[] = [{ player: candidate, fromIndex: null }];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const [index, { slot }] of starters.entries()) {
      if (cameFrom.has(index) || !canFill(next.player, slot)) continue;
      cameFrom.set(index, next);
      const holder = occupants[index];
      if (holder === null || holder === undefined) return followChain(occupants, cameFrom, index);
      queue.push({ player: holder, fromIndex: index });
    }
  }
  return null;
}

// Walks back from the open slot: each step's player takes the slot, leaving the one he came from
// to the step before, until the candidate (who came from the bench).
function followChain(
  occupants: (LineupPlayerRef | null)[],
  cameFrom: Map<number, ChainStep>,
  openIndex: number
): (LineupPlayerRef | null)[] {
  const placed = [...occupants];
  for (let index: number | null = openIndex; index !== null; ) {
    const step: ChainStep = cameFrom.get(index)!;
    placed[index] = step.player;
    index = step.fromIndex;
  }
  return placed;
}

function movesBetween(
  starters: readonly ClassifiableSlot[],
  before: (LineupPlayerRef | null)[],
  after: (LineupPlayerRef | null)[],
  candidate: LineupPlayerRef
): LineupMove[] {
  return after.flatMap((player, toIndex) => {
    if (player === null || player === candidate || player === before[toIndex]) return [];
    const fromIndex = before.indexOf(player);
    return [
      {
        playerId: player.playerId,
        fromSlot: starters[fromIndex]!.slot,
        toSlot: starters[toIndex]!.slot,
      },
    ];
  });
}

function startingSlots(
  starters: readonly ClassifiableSlot[],
  placed: (LineupPlayerRef | null)[]
): StartingSlot[] {
  return starters.map(({ slot }, index) => ({ slot, playerId: placed[index]?.playerId ?? null }));
}
