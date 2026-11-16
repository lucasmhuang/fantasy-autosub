import type { GameState, ProGame } from "@injurysub/espn";
import { describe, expect, it } from "vitest";
import type { BoardOption, BoardRosterRow, BoardStarter, TeamBoard } from "../../lib/server/board";
import type { HistoryEntry, TeamHistory } from "../../lib/server/request-view";
import { elementsWithClass, linksIn, renderMarkup, textOf } from "../test-support";
import { BoardView, type BoardViewProps } from "./board-view";

const PT = "America/Los_Angeles";
const NOW = new Date("2026-10-28T01:30:00.000Z");
const LILLARD = 6606;
const FEARS = 5144091;
const SHARPE = 4432194;

type Found = Extract<TeamBoard, { status: "board" }>;

const game = (fields: Partial<ProGame> = {}): ProGame => ({
  scoringPeriodId: 8,
  date: "2026-10-28T03:00:00.000Z",
  opponentProTeamId: 13,
  opponent: "LAL",
  home: false,
  ...fields,
});

const LIVE: GameState = {
  homeProTeamId: 2,
  awayProTeamId: 17,
  tip: "2026-10-27T23:30:00.000Z",
  phase: "live",
  period: 3,
  clock: "4:41",
};

const option = (fields: Partial<BoardOption> = {}): BoardOption => ({
  playerId: FEARS,
  name: "Jeremiah Fears",
  proTeam: "NO",
  position: "PG",
  gameState: null,
  status: "ready_now",
  reason: null,
  takenFor: null,
  edit: {
    items: [
      { playerId: LILLARD, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
      { playerId: FEARS, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" },
    ],
    movedStarters: 0,
  },
  warnings: [],
  gamesLeft: 3,
  todaysGame: null,
  nextGame: game({ opponent: "DAL" }),
  upcomingGames: [game({ opponent: "DAL" })],
  weekPoints: 0,
  seasonAveragePoints: 24.1,
  lineup: null,
  ...fields,
});

const starter = (fields: Partial<BoardStarter> = {}): BoardStarter => ({
  playerId: LILLARD,
  name: "Damian Lillard",
  proTeam: "POR",
  position: "PG",
  gameState: null,
  slot: "G",
  designation: "OUT",
  weekToDate: {
    fantasyPoints: 46.5,
    points: 30,
    rebounds: 4,
    assists: 8,
    steals: 1,
    blocks: 0,
    turnovers: 3,
  },
  forfeitTenths: 465,
  todaysGame: game(),
  nextGame: game(),
  startingDays: [{ scoringPeriodId: 7, date: "2026-10-26", points: 46.5 }],
  request: null,
  options: [option()],
  hiddenOptionCount: 0,
  optionCounts: { readyNow: 1, review: 0, notValid: 0 },
  ...fields,
});

const row = (
  slot: string,
  playerId: number,
  fields: Partial<NonNullable<BoardRosterRow["player"]>> = {}
): BoardRosterRow => ({
  slot,
  player: {
    playerId,
    name: `Player ${playerId}`,
    proTeam: "BKN",
    position: "C",
    designation: "ACTIVE",
    gameState: null,
    todaysGame: null,
    nextGame: game({ date: "2026-10-30T02:00:00.000Z", opponent: "MIA" }),
    weekPoints: 12.5,
    seasonAveragePoints: 20.2,
    ...fields,
  },
});

const found = (fields: Partial<Found> = {}): Found =>
  ({
    status: "board",
    teamId: 1,
    teamName: "Invented Team",
    readAt: "2026-10-28T01:20:00.000Z",
    stale: false,
    headline: "",
    week: {
      matchupPeriodId: 2,
      playoffs: false,
      firstDate: "2026-10-26",
      lastDate: "2026-11-01",
      afterLastGame: false,
      beforeFirstGame: false,
    },
    matchup: {
      mine: { teamId: 1, name: "Invented Team", total: 412.5, livePoints: 31.2 },
      opponent: { teamId: 7, name: "Rivals", total: 398.1, livePoints: 20 },
    },
    roster: {
      starters: [
        row("G", LILLARD, { name: "Damian Lillard", designation: "OUT" }),
        row("C", 111, { gameState: LIVE, todaysGame: game({ opponent: "BOS", home: true }) }),
        row("F", 222, { designation: "DAY_TO_DAY" }),
      ],
      bench: [row("BE", SHARPE, { gameState: LIVE, todaysGame: game({ opponent: "BOS" }) })],
      injuredReserve: [],
    },
    outStarters: [starter()],
    suspendedStarters: [],
    readyRoute: "now",
    ...fields,
  }) as Found;

const NO_HISTORY: TeamHistory = { status: "found", requests: [] };

const entry = (fields: Partial<HistoryEntry> = {}): HistoryEntry => ({
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "completed",
  injuredPlayerId: LILLARD,
  injuredName: "Damian Lillard",
  replacementPlayerId: FEARS,
  replacementName: "Jeremiah Fears",
  filedAt: new Date("2026-10-27T03:12:00.000Z"),
  matchupPeriodId: 2,
  amountTenths: -183,
  ...fields,
});

function view(props: Partial<BoardViewProps>) {
  return renderMarkup(
    <BoardView
      board={found()}
      history={NO_HISTORY}
      zone={PT}
      now={NOW}
      commissionerName="Sam Lee"
      title="Invented Team"
      subtitle="Dana · team 1"
      {...props}
    />
  )
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");
}

const text = (html: string) => textOf(html);
const hrefs = (html: string) => linksIn(html).map((link) => link.href);

describe("BoardView: one OUT starter", () => {
  it("leads with the headline and his card, the matchup after", () => {
    const html = view({});

    expect(html.indexOf("1 starter is OUT")).toBeLessThan(html.indexOf("This week's matchup"));
    expect(text(html)).toContain("A swap forfeits46.5pts");
    expect(text(html)).toContain("Next game Tue 8:00 PM PT @ LAL");
    expect(text(html)).toContain("While starting: Mon 46.5 · 1 game");
  });

  it("offers Choose on a phone and his options under the card at 1280", () => {
    const html = view({});

    expect(hrefs(html)).toContain("/app/requests/new?injured=6606");
    expect(text(html)).toContain("1 ready now");
    expect(elementsWithClass(html, "phone-only").length).toBeGreaterThan(0);
    expect(hrefs(html)).toContain("/app/requests/new?injured=6606&replacement=5144091");
    expect(text(html)).toContain("Ready now · 1");
  });

  it("shows his request instead of options, under the line that says so", () => {
    const html = view({
      board: found({
        outStarters: [
          starter({
            options: [],
            optionCounts: { readyNow: 0, review: 0, notValid: 0 },
            request: {
              requestId: "22222222-2222-4222-8222-222222222222",
              status: "executing",
              injuredName: "Damian Lillard",
              replacementName: "Jeremiah Fears",
              filedAt: new Date("2026-10-28T01:41:00.000Z"),
              amountTenths: -878,
            },
          }),
        ],
      }),
    });

    expect(text(html)).toContain("You already asked for a swap for him this week.");
    expect(hrefs(html)).toContain("/app/requests/22222222-2222-4222-8222-222222222222");
    expect(text(html)).toContain("Fears in for Lillard−87.8Asked Tue 6:41 PM PTIn progress");
    expect(hrefs(html)).not.toContain("/app/requests/new?injured=6606");
  });

  it("says no bench player fits, and that the commissioner can look further", () => {
    const html = view({
      board: found({
        outStarters: [
          starter({ options: [], optionCounts: { readyNow: 0, review: 0, notValid: 2 } }),
        ],
      }),
    });

    expect(text(html)).toContain("No one on your bench fits a legal lineup with Lillard out.");
    expect(text(html)).toContain("Sam can look at moves InjurySub doesn't make.");
    expect(hrefs(html)).not.toContain("/app/requests/new?injured=6606");
  });
});

describe("BoardView: other headlines", () => {
  it("gives each of several OUT starters his own Choose at every width", () => {
    const html = view({
      board: found({
        outStarters: [starter(), starter({ playerId: 4065648, name: "Jayson Tatum", slot: "F" })],
      }),
    });

    expect(text(html)).toContain("2 starters are OUTHandle them one at a time.");
    expect(hrefs(html)).toEqual(
      expect.arrayContaining([
        "/app/requests/new?injured=6606",
        "/app/requests/new?injured=4065648",
      ])
    );
    expect(hrefs(html)).not.toContain("/app/requests/new?injured=6606&replacement=5144091");
  });

  it("leads with the matchup when no starter is OUT, and says ESPN can lag", () => {
    const html = view({ board: found({ outStarters: [] }) });

    expect(html.indexOf("This week's matchup")).toBeLessThan(html.indexOf("No starters are OUT"));
    expect(text(html)).toContain(
      "ESPN can take a few minutes to show a new OUT. Refresh to check."
    );
  });

  it("gives a suspended starter an amber card the commissioner decides", () => {
    const html = view({
      board: found({
        outStarters: [],
        suspendedStarters: [starter({ designation: "SUSPENSION" })],
      }),
    });

    expect(text(html)).toContain("1 starter is suspendedYou can still ask; Sam decides.");
    expect(text(html)).toContain("If swapped, forfeits");
    expect(hrefs(html)).toContain("/app/requests/new?injured=6606");
  });

  it("says in a playoff week that the commissioner settles every swap, and a bye has no opponent", () => {
    const board = found({ week: { ...found().week, playoffs: true, matchupPeriodId: 19 } });
    const html = view({
      board: { ...board, matchup: { mine: board.matchup!.mine, opponent: null } },
    });

    expect(text(html)).toContain(
      "Playoff weeks: Sam settles every swap by hand. You can still ask."
    );
    expect(text(html)).toContain("Playoffs · Week 19 · Mon Oct 26 – Sun Nov 1");
    expect(text(html)).toContain("No opponent");
  });
});

describe("BoardView: the matchup, the roster and the freshness line", () => {
  it("shows each side's total and today's live points, labelled", () => {
    const html = view({});

    expect(text(html)).toContain("Week 2 · Mon Oct 26 – Sun Nov 1");
    expect(text(html)).toContain("412.5+31.2 today, live");
    expect(text(html)).toContain("Rivals398.1+20.0 today, live");
  });

  it("marks an OUT starter's row as a gap and gives live games a dot, starters' and bench's", () => {
    const html = view({});

    expect(elementsWithClass(html, "row-gap")).toHaveLength(1);
    expect(text(html)).toContain("BKN · Live, Q3 vs BOS");
    expect(text(html)).toContain("Day-to-day · BKN · next Thu");
    expect(elementsWithClass(html, "live").length).toBeGreaterThanOrEqual(2);
  });

  it("shows tip times and no live dot when the scoreboard wasn't read", () => {
    const board = found();
    const unread = {
      ...board,
      roster: {
        ...board.roster,
        starters: board.roster.starters.map((each) =>
          each.player ? { ...each, player: { ...each.player, gameState: null } } : each
        ),
        bench: board.roster.bench.map((each) =>
          each.player ? { ...each, player: { ...each.player, gameState: null } } : each
        ),
      },
    };
    const html = view({ board: unread });

    expect(text(html)).toContain("BKN · 8:00 PM PT vs BOS");
    expect(
      elementsWithClass(html, "row-meta").some((each) => each.attributes.class?.includes("live"))
    ).toBe(false);
    expect(html).not.toContain('aria-label="Live"');
  });

  it("says when ESPN was read, with Refresh", () => {
    const html = view({});

    expect(text(html)).toContain("As of Tue 6:20 PM PT");
    expect(linksIn(html)).toContainEqual(
      expect.objectContaining({ href: "/app", text: "Refresh" })
    );
  });
});

describe("BoardView: stale, late and unread", () => {
  it("shows the last read under one notice, without live dots or choices", () => {
    const html = view({ board: found({ stale: true }) });

    expect(text(html)).toContain(
      "Can't reach ESPN right now. Your team below is from Tue 6:20 PM PT. Starter ruled OUT? Text Sam; they can file it with the time you asked."
    );
    expect(text(html)).toContain("412.5+31.2 today");
    expect(text(html)).not.toContain("today, live");
    expect(html).not.toContain('aria-label="Live"');
    expect(hrefs(html)).not.toContain("/app/requests/new?injured=6606");
  });

  it("says no more swaps after the week's last game, and when ESPN's day ends", () => {
    const html = view({ board: found({ week: { ...found().week, afterLastGame: true } }) });

    expect(text(html)).toContain("The week's last game has ended, so no more swaps this week.");
    expect(text(html)).toContain(
      "ESPN's day ends at midnight PT; it can still correct stats after that."
    );
    expect(hrefs(html)).not.toContain("/app/requests/new?injured=6606");
  });

  it.each([
    ["worker_down", "Can't load your team right now", true],
    ["credentials_rejected", "Can't read ESPN", false],
    ["not_connected", "ESPN isn't connected yet", false],
    ["unavailable", "Can't reach ESPN right now", true],
    ["no_team", "No team yet", false],
  ] as const)("says why there's no team for %s, keeping the requests", (status, title, retry) => {
    const html = view({ board: { status }, history: { status: "found", requests: [entry()] } });

    expect(text(html)).toContain(title);
    expect(linksIn(html).some((link) => link.text === "Try again")).toBe(retry);
    expect(status === "no_team" || text(html).includes("Fears in for Lillard")).toBe(true);
  });
});

describe("BoardView: your requests", () => {
  it("lists them newest first with faces, amount, status and when", () => {
    const html = view({ history: { status: "found", requests: [entry()] } });

    expect(text(html)).toContain("Your requests");
    expect(text(html)).toContain("Fears in for Lillard−18.3DoneMon 8:12 PM PT · week 2");
    expect(hrefs(html)).toContain("/app/requests/11111111-1111-4111-8111-111111111111");
  });

  it("says when there are none, and when they can't be read", () => {
    expect(text(view({}))).toContain("No requests yet.");
    expect(text(view({ history: { status: "unavailable" } }))).toContain(
      "Your requests can't be shown right now. Try again in a moment."
    );
  });
});
