import type { GameState } from "@injurysub/espn";
import { describe, expect, it } from "vitest";
import type { BoardOption, BoardStarter, ReadyRoute } from "../../lib/server/board";
import { linksIn, renderMarkup, textOf } from "../test-support";
import { ChooseView } from "./choose-view";

const PT = "America/Los_Angeles";

const option = (playerId: number, fields: Partial<BoardOption> = {}): BoardOption => ({
  playerId,
  name: `Bench ${playerId}`,
  proTeam: "MIA",
  position: "C",
  gameState: null,
  status: "ready_now",
  reason: null,
  takenFor: null,
  edit: null,
  warnings: [],
  gamesLeft: 2,
  todaysGame: null,
  nextGame: null,
  upcomingGames: [],
  weekPoints: 0,
  seasonAveragePoints: 20,
  lineup: null,
  ...fields,
});

const starter = (fields: Partial<BoardStarter> = {}): BoardStarter => ({
  playerId: 6606,
  name: "Damian Lillard",
  proTeam: "POR",
  position: "PG",
  gameState: null,
  slot: "G",
  designation: "OUT",
  weekToDate: {
    fantasyPoints: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
  },
  forfeitTenths: 821,
  todaysGame: null,
  nextGame: null,
  startingDays: [],
  request: null,
  options: [option(1), option(2, { status: "review_required", reason: "other_starters_move" })],
  hiddenOptionCount: 0,
  optionCounts: { readyNow: 1, review: 1, notValid: 0 },
  ...fields,
});

const render = (fields: Partial<BoardStarter> = {}, route: ReadyRoute = "now") =>
  textOf(
    renderMarkup(
      <ChooseView
        state="found"
        starter={starter(fields)}
        route={route}
        readAt="2026-10-28T01:20:00.000Z"
        zone={PT}
        now={new Date("2026-10-28T01:30:00.000Z")}
        commissionerName="Sam Lee"
      />
    ).replaceAll("<!-- -->", "")
  );

describe("ChooseView", () => {
  it("heads the options with the starter, his slot and what a swap forfeits", () => {
    expect(render()).toContain("Replace Damian LillardG slot · a swap forfeits 82.1");
  });

  it.each([
    ["now", "Ready now · 1"],
    ["approval", "Ready once Sam approves · 1"],
    ["commissioner", "Sam makes it · 1"],
  ] as const)("labels the Ready group for the %s route, the commissioner's apart", (route, label) => {
    const text = render({}, route);

    expect(text).toContain(label);
    expect(text).toContain("Sam decides · 1");
  });

  it("gives a suspended starter's options to the commissioner, saying so", () => {
    const text = render({
      designation: "SUSPENSION",
      options: [option(1, { status: "review_required", reason: "suspension" })],
    });

    expect(text).toContain("Pick one; Sam settles it.");
    expect(text).toContain("G slot · suspended · a swap forfeits");
    expect(text).toContain("Sam decides · 1");
  });

  it("says no bench player fits when every option is Not valid", () => {
    const text = render({
      options: [option(1, { status: "not_valid", reason: "no_valid_lineup" })],
    });

    expect(text).toContain("No one on your bench fits a legal lineup with Lillard out.");
    expect(text).toContain(
      "Sam can look at moves InjurySub doesn't make, like two starters changing slots at once."
    );
  });

  it("marks an option whose game is on as live, with its quarter", () => {
    const live: GameState = {
      homeProTeamId: 14,
      awayProTeamId: 1,
      tip: "2026-10-28T00:30:00.000Z",
      phase: "live",
      period: 3,
      clock: "5:00",
    };
    const todaysGame = {
      scoringPeriodId: 8,
      date: "2026-10-28T00:30:00.000Z",
      opponentProTeamId: 1,
      opponent: "ATL",
      home: true,
    };
    const markup = renderMarkup(
      <ChooseView
        state="found"
        starter={starter({ options: [option(1, { gameState: live, todaysGame })] })}
        route="now"
        readAt="2026-10-28T01:20:00.000Z"
        zone={PT}
        now={new Date("2026-10-28T01:30:00.000Z")}
        commissionerName="Sam Lee"
      />
    ).replaceAll("<!-- -->", "");

    expect(textOf(markup)).toContain("Live, Q3 vs ATL");
    expect(markup).toContain('class="live');
  });

  it("refreshes Choose itself", () => {
    const markup = renderMarkup(
      <ChooseView
        state="found"
        starter={starter()}
        route="now"
        readAt="2026-10-28T01:20:00.000Z"
        zone={PT}
        now={new Date("2026-10-28T01:30:00.000Z")}
        commissionerName={null}
      />
    );

    expect(linksIn(markup)).toContainEqual({
      href: "/app/requests/new?injured=6606",
      text: "Refresh",
    });
  });
});
