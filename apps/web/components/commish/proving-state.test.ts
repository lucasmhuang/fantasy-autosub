import { describe, expect, it } from "vitest";
import { chosenOption } from "./proving-state";

const options = [
  {
    playerId: 11,
    name: "Walker Kessler",
    kind: "direct_swap" as const,
    moves: [],
    digest: "11:12>0",
  },
  {
    playerId: 22,
    name: "Keegan Murray",
    kind: "one_move" as const,
    moves: [],
    digest: "22:12>4,3:4>0",
  },
];

// The start form posts the chosen bench player's edit, as the page showed it (R4).
describe("the proving form's chosen option", () => {
  it("carries the edit of the bench player picked", () => {
    expect(chosenOption(options, "22")).toEqual(options[1]);
  });

  it("starts on the first option, and keeps it for an unknown pick", () => {
    expect(chosenOption(options, null)).toEqual(options[0]);
    expect(chosenOption(options, "99")).toEqual(options[0]);
  });

  it("has none when there are no options", () => {
    expect(chosenOption([], null)).toBeNull();
  });
});
