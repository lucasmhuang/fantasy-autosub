import { PACIFIC } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import type { BoardOption } from "../../lib/server/board";
import { linksIn, renderMarkup } from "../test-support";
import { OptionRow } from "./option-row";

const option: BoardOption = {
  playerId: 5144091,
  name: "Invented Bench",
  proTeam: "SAC",
  position: "G",
  gameState: null,
  status: "ready_now",
  reason: null,
  takenFor: null,
  edit: {
    items: [
      { playerId: 6606, name: "Invented Starter", fromSlot: "G", toSlot: "BE" },
      { playerId: 5144091, name: "Invented Bench", fromSlot: "BE", toSlot: "G" },
    ],
    movedStarters: 0,
  },
  warnings: [],
  gamesLeft: 3,
  todaysGame: null,
  nextGame: null,
  upcomingGames: [],
  weekPoints: 0,
  seasonAveragePoints: 21.4,
  lineup: null,
};

// RS-CHOOSE-4: the Confirm route answers back to this address, so its path and names hold.
describe("OptionRow", () => {
  it("opens Confirm for this starter and this replacement", () => {
    const markup = renderMarkup(<OptionRow option={option} injuredId={6606} zone={PACIFIC} />);

    expect(linksIn(markup)).toEqual([
      { href: "/app/requests/new?injured=6606&replacement=5144091", text: "Choose Invented Bench" },
    ]);
  });

  it("offers no Choose for an option that isn't valid", () => {
    const notValid: BoardOption = {
      ...option,
      status: "not_valid",
      reason: "no_valid_lineup",
      edit: null,
    };

    expect(
      linksIn(renderMarkup(<OptionRow option={notValid} injuredId={6606} zone={PACIFIC} />))
    ).toEqual([]);
  });
});
