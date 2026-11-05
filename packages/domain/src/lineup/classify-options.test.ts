import { describe, expect, it } from "vitest";
import {
  type ClassifiableLineup,
  classifyReplacementOptions,
  type LineupPlayerRef,
  type ReplacementOption,
} from "./classify-options";

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

function player(playerId: number, position: Position): LineupPlayerRef {
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

function lineup(
  bench: (LineupPlayerRef | null)[],
  overrides: Partial<Record<number, LineupPlayerRef | null>> = {}
): ClassifiableLineup {
  return {
    starters: startersWith(overrides),
    bench: bench.map((benched) => ({ slot: "BE", player: benched })),
    injuredReserve: [{ slot: "IR", player: player(99, "pg") }],
  };
}

function optionsFor(input: ClassifiableLineup, injuredPlayerId: number): ReplacementOption[] {
  const result = classifyReplacementOptions({ lineup: input, injuredPlayerId });
  if (!result.ok) throw new Error(`expected options, got ${result.reason}`);
  return result.options;
}

function playersBySlot(option: ReplacementOption): string[] {
  if (option.kind === "invalid") throw new Error("an invalid option has no lineup");
  return option.lineup.map(({ slot, playerId }) => `${slot}:${playerId}`);
}

describe("classifyReplacementOptions", () => {
  it("offers a guard on the bench as a direct swap for an injured guard", () => {
    const [option] = optionsFor(lineup([player(20, "pg")]), 2);

    expect(option).toMatchObject({ playerId: 20, kind: "direct", moves: [] });
    expect(playersBySlot(option!)).toEqual([
      "G:1",
      "G:20",
      "G:3",
      "F:4",
      "F:5",
      "F:6",
      "C:7",
      "F/C:8",
      "UTIL:9",
      "UTIL:10",
    ]);
  });

  it("needs a rearrangement when a bench forward fits only once a guard-eligible UTIL starter moves to G", () => {
    const options = optionsFor(lineup([player(20, "sf")], { 9: player(9, "gf") }), 2);

    expect(options).toEqual([
      {
        playerId: 20,
        kind: "rearrangement",
        moves: [{ playerId: 9, fromSlot: "UTIL", toSlot: "G" }],
        lineup: [
          { slot: "G", playerId: 1 },
          { slot: "G", playerId: 9 },
          { slot: "G", playerId: 3 },
          { slot: "F", playerId: 4 },
          { slot: "F", playerId: 5 },
          { slot: "F", playerId: 6 },
          { slot: "C", playerId: 7 },
          { slot: "F/C", playerId: 8 },
          { slot: "UTIL", playerId: 20 },
          { slot: "UTIL", playerId: 10 },
        ],
      },
    ]);
  });

  it("refuses guards for an injured center when no starter who can play C can move", () => {
    // With a forward in place of the UTIL center (10), no starter can play C.
    const options = optionsFor(
      lineup([player(20, "pg"), player(21, "sg")], { 10: player(10, "sf") }),
      7
    );

    expect(options).toEqual([
      { playerId: 20, kind: "invalid", reason: "no_slot_fits" },
      { playerId: 21, kind: "invalid", reason: "no_slot_fits" },
    ]);
  });

  it("offers every bench player as a direct swap for an injured UTIL starter", () => {
    const options = optionsFor(lineup([player(20, "pg"), player(21, "c"), player(22, "sf")]), 9);

    expect(options.map(({ playerId, kind }) => ({ playerId, kind }))).toEqual([
      { playerId: 20, kind: "direct" },
      { playerId: 21, kind: "direct" },
      { playerId: 22, kind: "direct" },
    ]);
  });

  it("skips empty bench slots and never offers a player on IR", () => {
    const options = optionsFor(lineup([null, player(20, "pg"), null]), 2);

    expect(options.map(({ playerId }) => playerId)).toEqual([20]);
  });

  it("fills all ten starting slots, with the injured starter out of them", () => {
    const [option] = optionsFor(lineup([player(20, "pg")]), 2);

    expect(playersBySlot(option!)).toHaveLength(10);
    expect(playersBySlot(option!)).not.toContain("G:2");
  });

  it("refuses a player who isn't in a starting slot", () => {
    const result = classifyReplacementOptions({
      lineup: lineup([player(20, "pg")]),
      injuredPlayerId: 20,
    });

    expect(result).toEqual({ ok: false, reason: "injured_not_starting" });
  });
});
