import type { ClassifiableLineup, LineupPlayerRef } from "./classify-options";

// Lineups for the domain's tests. Test code only; the package entry doesn't export it.

// Eligible slots as ESPN lists them for each position.
const eligibility = {
  pg: ["PG", "G", "UTIL", "BE", "IR"],
  sg: ["SG", "G", "SG/SF", "G/F", "UTIL", "BE", "IR"],
  sf: ["SF", "F", "SG/SF", "G/F", "UTIL", "BE", "IR"],
  pf: ["PF", "F", "PF/C", "F/C", "UTIL", "BE", "IR"],
  c: ["C", "PF/C", "F/C", "UTIL", "BE", "IR"],
  gf: ["SG", "SF", "G", "F", "SG/SF", "G/F", "UTIL", "BE", "IR"],
  fc: ["PF", "C", "F", "PF/C", "F/C", "UTIL", "BE", "IR"],
} as const;

type Position = keyof typeof eligibility;

export function player(playerId: number, position: Position): LineupPlayerRef {
  return { playerId, eligibleSlots: eligibility[position] };
}

// The league's ten starters: G G G F F F C F/C UTIL UTIL, ids 1-10.
function startersWith(overrides: Partial<Record<number, LineupPlayerRef | null>> = {}) {
  const defaults: [string, LineupPlayerRef][] = [
    ["G", player(1, "pg")],
    ["G", player(2, "sg")],
    ["G", player(3, "pg")],
    ["F", player(4, "sf")],
    ["F", player(5, "pf")],
    ["F", player(6, "sf")],
    ["C", player(7, "c")],
    ["F/C", player(8, "pf")],
    ["UTIL", player(9, "pf")],
    ["UTIL", player(10, "c")],
  ];
  return defaults.map(([slot, starter], index) => ({
    slot,
    player: index + 1 in overrides ? (overrides[index + 1] ?? null) : starter,
  }));
}

// The league's starters with the bench given; `overrides` replaces starters by position, 1-10
// (null empties the slot). Player 99 is on IR.
export function lineup(
  bench: (LineupPlayerRef | null)[],
  overrides: Partial<Record<number, LineupPlayerRef | null>> = {}
): ClassifiableLineup {
  return {
    starters: startersWith(overrides),
    bench: bench.map((benched) => ({ slot: "BE", player: benched })),
    injuredReserve: [{ slot: "IR", player: player(99, "pg") }],
  };
}
