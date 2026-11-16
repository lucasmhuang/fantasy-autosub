import type { ProGame } from "@injurysub/espn";
import { describe, expect, it } from "vitest";
import type { BoardEdit, BoardOption } from "../../lib/server/board";
import { gameDays, optionLabel, optionNotes } from "./option-copy";

const PT = "America/Los_Angeles";

const edit = (items: [string, string, string][]): BoardEdit => ({
  items: items.map(([name, fromSlot, toSlot], index) => ({
    playerId: index,
    name,
    fromSlot,
    toSlot,
  })),
  movedStarters: Math.max(0, items.length - 2),
});

const option = (fields: Partial<BoardOption>): BoardOption => ({
  playerId: 1,
  name: "Keegan Murray",
  proTeam: "SAC",
  position: "SF/PF",
  gameState: null,
  status: "ready_now",
  reason: null,
  takenFor: null,
  edit: edit([
    ["Joel Embiid", "C", "BE"],
    ["Keegan Murray", "BE", "C"],
  ]),
  warnings: [],
  gamesLeft: 3,
  todaysGame: null,
  nextGame: null,
  upcomingGames: [],
  weekPoints: 0,
  seasonAveragePoints: 31.2,
  lineup: null,
  ...fields,
});

describe("optionNotes", () => {
  it("says nothing for a direct swap, and names a one-move rearrangement or an open slot", () => {
    expect(optionNotes(option({}))).toEqual([]);
    expect(
      optionNotes(
        option({
          edit: edit([
            ["Joel Embiid", "C", "BE"],
            ["Bam Adebayo", "F/C", "C"],
            ["Keegan Murray", "BE", "F/C"],
          ]),
        })
      )
    ).toEqual([{ kind: "move", text: "Bam Adebayo moves to C; Murray takes F/C." }]);
    expect(
      optionNotes(
        option({
          edit: edit([
            ["Joel Embiid", "C", "BE"],
            ["Keegan Murray", "BE", "UTIL"],
          ]),
        })
      )
    ).toEqual([{ kind: "move", text: "Takes the open UTIL. No one else moves." }]);
  });

  it("names the starters a commissioner's rearrangement would move", () => {
    const notes = optionNotes(
      option({
        status: "review_required",
        reason: "other_starters_move",
        edit: edit([
          ["Joel Embiid", "C", "BE"],
          ["Lauri Markkanen", "F", "F/C"],
          ["Bam Adebayo", "F/C", "C"],
          ["Coby White", "BE", "F"],
        ]),
      })
    );

    expect(notes).toEqual([
      { kind: "review", text: "Two other starters would move: Markkanen to F/C, Adebayo to C." },
    ]);
  });

  it("says why an option isn't valid, and warns about points and games that won't count", () => {
    expect(
      optionNotes(
        option({ status: "not_valid", reason: "taken", takenFor: "Joel Embiid", edit: null })
      )
    ).toEqual([{ kind: "stop", text: "Named in your request for Embiid, still in progress." }]);
    expect(
      optionNotes(option({ status: "not_valid", reason: "no_valid_lineup", edit: null }))
    ).toEqual([{ kind: "stop", text: "No legal lineup with him in it." }]);
    expect(
      optionNotes(option({ warnings: ["already_scored", "no_games_left"], weekPoints: 5.7 }))
    ).toEqual([
      { kind: "taken", text: "−5.7 scored before you ask won't count" },
      { kind: "warn", text: "No games left this week, so he can't add points." },
    ]);
  });
});

describe("optionLabel", () => {
  it("speaks the full name and where the option goes", () => {
    expect(optionLabel(option({}), "now", "Sam")).toBe("Keegan Murray, ready now");
    expect(optionLabel(option({}), "approval", "Sam")).toBe(
      "Keegan Murray, ready once Sam approves"
    );
    expect(optionLabel(option({}), "commissioner", "Sam")).toBe("Keegan Murray, Sam decides");
    expect(optionLabel(option({ status: "review_required" }), "now", "Sam")).toBe(
      "Keegan Murray, Sam decides"
    );
  });
});

describe("gameDays", () => {
  it("lists his games' weekdays in the reader's zone", () => {
    const at = (date: string): ProGame => ({
      scoringPeriodId: 1,
      date,
      opponentProTeamId: 1,
      opponent: "BOS",
      home: true,
    });

    expect(gameDays([at("2026-10-29T02:00:00.000Z"), at("2026-10-31T00:30:00.000Z")], PT)).toBe(
      "Wed, Fri"
    );
    expect(gameDays([], PT)).toBe("None");
  });
});
