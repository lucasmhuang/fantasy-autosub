import { planLineupEdit, routeRequest } from "@injurysub/domain";
import {
  createEspnReadClient,
  EspnError,
  type EspnErrorCode,
  type GameState,
  type GameStatesRead,
  type MatchupSide,
  type ScenarioName,
  type TeamWeekRead,
} from "@injurysub/espn";
import { describe, expect } from "vitest";
import {
  type BoardRosterRow,
  type BoardStarter,
  forgetLastReads,
  loadTeamBoard,
  type TeamBoard,
} from "./board";
import { createWebDatabaseConnection } from "./db";
import {
  insertInventedRequest,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
  withEligibleSlots,
} from "./test-support";

// Team 1 in the scenarios: Damian Lillard (6606) is the OUT guard, Jayson Tatum (4065648) the
// second OUT starter, on day 8 of matchup 2 (days 7-13); the bench is Zach Edey (4600663), Day'Ron
// Sharpe (4432194), Jeremiah Fears (5144091) and Pelle Larsson (4601025); IR holds Keegan Murray
// (4594327) and Jalen Suggs (4432165), both OUT.
const LILLARD = 6606;
const TATUM = 4065648;
const EDEY = 4600663;
const FEARS = 5144091;
// A guard at UTIL: a center from the bench takes his UTIL once he moves to Lillard's G.
const UTIL_GUARD = 4900671;
const BENCH = [EDEY, 4432194, FEARS, 4601025];
const IR = [4594327, 4432165];

type ReadChange = TeamWeekChange;

function webEspnFor(espn: Parameters<typeof setWebEspn>[0], change?: ReadChange): void {
  setWebEspn(espn, change);
}

function scripted(scenario: ScenarioName, change?: ReadChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario }), change);
}

function refusingWith(code: EspnErrorCode): void {
  setRefusingWebEspn(code);
}

function boardOf(result: TeamBoard): Extract<TeamBoard, { status: "board" }> {
  if (result.status !== "board") throw new Error(`expected a board, got ${result.status}`);
  return result;
}

function starter(board: Extract<TeamBoard, { status: "board" }>, playerId: number): BoardStarter {
  const found = [...board.outStarters, ...board.suspendedStarters].find(
    (each) => each.playerId === playerId
  );
  if (found === undefined) throw new Error(`no starter ${playerId} on the board`);
  return found;
}

// One bench player's games left changed in the read.
function withGamesLeft(playerId: number, gamesLeft: number): ReadChange {
  return (read) => ({
    ...read,
    players: read.players.map((player) =>
      player.playerId === playerId ? { ...player, gamesLeft } : player
    ),
  });
}

// One bench player with a line on the week's first day, benched.
function withBenchLine(playerId: number, fantasyPoints: number): ReadChange {
  const line = {
    fantasyPoints,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
  };
  return (read) => ({
    ...read,
    days: read.days.map((day) =>
      day.scoringPeriodId !== 7
        ? day
        : {
            ...day,
            players: day.players.map((each) =>
              each.playerId === playerId ? { ...each, active: false, line } : each
            ),
          }
    ),
  });
}

// The UTIL guard able to play forward only: a center then fits Lillard's G only once he moves to
// F and a guard-eligible forward moves to G (two moves).
const utilGuardForwardOnly = withEligibleSlots(UTIL_GUARD, ["SF", "F", "UTIL", "BE", "IR"]);

// One bench player whom no starting slot can take.
function withBenchPlayerUnplaceable(playerId: number): ReadChange {
  return (read) => ({
    ...read,
    lineup: {
      ...read.lineup,
      bench: read.lineup.bench.map((slot) =>
        slot.player?.playerId === playerId
          ? { ...slot, player: { ...slot.player, eligibleSlots: ["BE", "IR"] } }
          : slot
      ),
    },
  });
}

// Day 8's games in the recordings, all on 2026-10-27 Pacific: Lillard's POR at LAL (03:00Z, the
// next UTC day) and Day'Ron Sharpe's BKN at BOS (23:30Z). No other bench player plays that day.
const SHARPE = 4432194;
const POR_AT_LAL: GameState = {
  homeProTeamId: 13,
  awayProTeamId: 22,
  tip: "2026-10-28T03:00:00.000Z",
  phase: "scheduled",
  period: 0,
  clock: "0.0",
};
const BKN_AT_BOS: GameState = {
  homeProTeamId: 2,
  awayProTeamId: 17,
  tip: "2026-10-27T23:30:00.000Z",
  phase: "live",
  period: 3,
  clock: "4:41",
};

// The one-out-starter scenario, its scoreboard answering `answer` and keeping each date asked.
function scriptedWithScoreboard(
  answer: (date: string) => Promise<readonly GameState[]>,
  change?: ReadChange
): string[] {
  const asked: string[] = [];
  const espn = createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" });
  setWebEspn(
    {
      ...espn,
      getGameStates: async (date): Promise<GameStatesRead> => {
        asked.push(date);
        return {
          meta: { source: "live", readAt: "2026-10-28T01:00:00.000Z" },
          date,
          games: await answer(date),
        };
      },
    },
    change
  );
  return asked;
}

function option(board: Extract<TeamBoard, { status: "board" }>, playerId: number) {
  const found = starter(board, LILLARD).options.find((each) => each.playerId === playerId);
  if (found === undefined) throw new Error(`no option ${playerId} for Lillard`);
  return found;
}

// Every game state on the board, by player: the starters' and their options'.
function gameStatesOn(board: Extract<TeamBoard, { status: "board" }>) {
  return [...board.outStarters, ...board.suspendedStarters].flatMap((each) => [
    [each.playerId, each.gameState] as const,
    ...each.options.map((choice) => [choice.playerId, choice.gameState] as const),
  ]);
}

describe("loadTeamBoard: game states", () => {
  // ESPN's day is Pacific, so the scoreboard is asked for the Pacific date of today's tips: an
  // evening tip's UTC date (Lillard's, 03:00Z on the 28th) would ask the next day's slate. Only his
  // game is left here, so the date can only come from a tip whose UTC date is the next day's.
  webDbTest("asks the scoreboard once, for the Pacific date of today's games", async () => {
    const asked = scriptedWithScoreboard(
      async () => [],
      (read) => ({
        ...read,
        players: read.players.map((player) => ({
          ...player,
          weekGames: player.weekGames.filter(
            (game) =>
              game.scoringPeriodId !== read.week.todayScoringPeriodId || player.playerId === LILLARD
          ),
        })),
      })
    );

    await loadTeamBoard({ teamId: 1, revealAll: true });

    expect(asked).toEqual(["2026-10-27"]);
  });

  webDbTest(
    "gives each player whose game is today that game's state, and others none",
    async () => {
      scriptedWithScoreboard(async () => [POR_AT_LAL, BKN_AT_BOS]);

      const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: true }));

      expect(starter(board, LILLARD).gameState).toEqual(POR_AT_LAL);
      expect(option(board, SHARPE).gameState).toEqual(BKN_AT_BOS);
      expect(option(board, EDEY).gameState).toBeNull();
    }
  );

  // FM-BOARD-9: when the game state can't be read, the board shows tip times and no live state,
  // and nothing else on it changes.
  webDbTest.for(["not_recorded", "espn_unavailable", "worker_unreachable"] as const)(
    "shows no game state when the scoreboard fails with %s, and nothing else changes",
    async (code, { webLog }) => {
      scriptedWithScoreboard(async () => []);
      const unread = boardOf(await loadTeamBoard({ teamId: 1, revealAll: true }));
      scriptedWithScoreboard(async () => Promise.reject(new EspnError(code, "invented refusal")));

      const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: true }));

      expect(gameStatesOn(board).filter(([, state]) => state !== null)).toEqual([]);
      expect({ ...board, readAt: "read time" }).toEqual({ ...unread, readAt: "read time" });
      expect(webLog.events()).toContainEqual(
        expect.objectContaining({ event: "web.board.game_states_unread", code })
      );
    }
  );

  webDbTest("asks nothing when none of the team's players plays today", async () => {
    const asked = scriptedWithScoreboard(
      async () => [POR_AT_LAL, BKN_AT_BOS],
      (read) => ({
        ...read,
        players: read.players.map((player) => ({
          ...player,
          weekGames: player.weekGames.filter(
            (game) => game.scoringPeriodId !== read.week.todayScoringPeriodId
          ),
        })),
      })
    );

    const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: true }));

    expect(asked).toEqual([]);
    expect(gameStatesOn(board).filter(([, state]) => state !== null)).toEqual([]);
  });
});

describe("loadTeamBoard", () => {
  webDbTest("lists the team's OUT starter with his week and what a sub would forfeit", async () => {
    scripted("one-out-starter");

    const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

    expect(board.headline).toBe("You have 1 starter currently OUT");
    expect(board.outStarters.map((each) => each.playerId)).toEqual([LILLARD]);
    expect(board.suspendedStarters).toEqual([]);
    const lillard = starter(board, LILLARD);
    expect(lillard).toMatchObject({
      name: "Damian Lillard",
      proTeam: expect.any(String),
      position: "PG",
      slot: "G",
      designation: "OUT",
      request: null,
    });
    expect(lillard.weekToDate).toMatchObject({ fantasyPoints: expect.any(Number) });
    expect(lillard.forfeitTenths).toBeGreaterThanOrEqual(0);
    expect(board.readAt).toEqual(expect.any(String));
  });

  webDbTest("offers the bench, never IR, with Ready now first and each one's week", async () => {
    scripted("one-out-starter");

    const { options } = starter(
      boardOf(await loadTeamBoard({ teamId: 1, revealAll: true })),
      LILLARD
    );

    expect(options.map((option) => option.playerId).sort()).toEqual([...BENCH].sort());
    expect(options.some((option) => IR.includes(option.playerId))).toBe(false);
    const ranks = { ready_now: 0, review_required: 1, not_valid: 2 } as const;
    const statusRanks = options.map((option) => ranks[option.status]);
    expect(statusRanks).toEqual([...statusRanks].sort((a, b) => a - b));
    const fears = options.find((option) => option.playerId === FEARS);
    expect(fears).toMatchObject({ status: "ready_now", reason: null });
    expect(fears).toMatchObject({
      proTeam: expect.any(String),
      gamesLeft: 3,
      nextGame: { date: "2026-10-29T00:00:00.000Z" },
      seasonAveragePoints: expect.any(Number),
    });
    expect(fears?.lineup?.find((slot) => slot.playerId === FEARS)).toMatchObject({
      slot: "G",
      name: "Jeremiah Fears",
    });
    expect(fears?.lineup?.some((slot) => slot.playerId === LILLARD)).toBe(false);
  });

  webDbTest(
    "says why the commissioner must handle an option that moves two other starters",
    async () => {
      scripted("one-out-starter", utilGuardForwardOnly);

      const { options } = starter(
        boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })),
        LILLARD
      );

      expect(options.find((option) => option.playerId === EDEY)).toMatchObject({
        status: "review_required",
        reason: "other_starters_move",
      });
    }
  );

  webDbTest("offers a one-move rearrangement as Ready now, naming its move", async () => {
    scripted("one-out-starter");

    const { options } = starter(
      boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })),
      LILLARD
    );

    expect(options.find((option) => option.playerId === EDEY)).toMatchObject({
      status: "ready_now",
      reason: null,
      edit: {
        items: [
          { playerId: LILLARD, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
          { playerId: UTIL_GUARD, name: expect.any(String), fromSlot: "UTIL", toSlot: "G" },
          { playerId: EDEY, name: "Zach Edey", fromSlot: "BE", toSlot: "UTIL" },
        ],
        movedStarters: 1,
      },
    });
  });

  webDbTest(
    "shows each option as Confirm would route it, whether it moves no, one or two other starters",
    async () => {
      const movedStarters = new Set<number>();
      for (const change of [undefined, utilGuardForwardOnly]) {
        scripted("one-out-starter", change);
        const raw = await createEspnReadClient({
          mode: "scripted",
          scenario: "one-out-starter",
        }).getTeamWeek(1);
        const read = change === undefined ? raw : change(raw);
        const { options } = starter(
          boardOf(await loadTeamBoard({ teamId: 1, revealAll: true })),
          LILLARD
        );

        for (const option of options) {
          const edit = planLineupEdit({
            lineup: read.lineup,
            injuredPlayerId: LILLARD,
            replacementPlayerId: option.playerId,
          });
          if (edit === null) throw new Error(`no edit for ${option.playerId}`);
          movedStarters.add(edit.movedStarters);
          const routed = routeRequest({
            kind: "substitution",
            teamId: 1,
            edit,
            injuredDesignation: "OUT",
            period: { isPlayoffs: false, hasOpponent: true },
            allowlist: [1],
            mode: "auto",
          });
          expect(option.status).toBe(routed.status === "queued" ? "ready_now" : "review_required");
        }
      }
      expect([...movedStarters].sort()).toEqual([0, 1, 2]);
    }
  );

  webDbTest("hides Not valid options until every bench player is asked for", async () => {
    scripted("one-out-starter", withBenchPlayerUnplaceable(EDEY));

    const hidden = starter(boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })), LILLARD);
    const shown = starter(boardOf(await loadTeamBoard({ teamId: 1, revealAll: true })), LILLARD);

    expect(hidden.options.some((option) => option.playerId === EDEY)).toBe(false);
    expect(hidden.hiddenOptionCount).toBe(1);
    expect(shown.options.at(-1)).toMatchObject({
      playerId: EDEY,
      status: "not_valid",
      reason: "no_valid_lineup",
      lineup: null,
    });
  });

  webDbTest("warns, without refusing, about a replacement with no games left", async () => {
    scripted("one-out-starter", withGamesLeft(FEARS, 0));

    const { options } = starter(
      boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })),
      LILLARD
    );

    expect(options.find((option) => option.playerId === FEARS)).toMatchObject({
      status: "ready_now",
      warnings: ["no_games_left"],
    });
  });

  webDbTest("warns, without refusing, about a replacement who has scored this week", async () => {
    scripted("one-out-starter", withBenchLine(FEARS, 12.4));

    const { options } = starter(
      boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })),
      LILLARD
    );

    expect(options.find((option) => option.playerId === FEARS)).toMatchObject({
      status: "ready_now",
      warnings: ["already_scored"],
    });
  });

  webDbTest("says so when no starter is OUT, offering nothing", async () => {
    webEspnFor(createEspnReadClient({ mode: "stub" }));

    const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

    expect(board.outStarters).toEqual([]);
    expect(board.headline).toBe(
      "None of your starters are currently listed as OUT. If this just changed, give ESPN a few minutes to update and refresh."
    );
  });

  webDbTest("handles each of two OUT starters on its own", async () => {
    scripted("two-out-starters");

    const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

    expect(board.headline).toBe("You have 2 starters currently OUT");
    expect(board.outStarters.map((each) => each.playerId)).toEqual([LILLARD, TATUM]);
    for (const each of board.outStarters) expect(each.options.length).toBeGreaterThan(0);
  });

  webDbTest("lists a suspended starter apart, every option for the commissioner", async () => {
    scripted("suspended-starter");

    const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

    expect(board.outStarters).toEqual([]);
    const lillard = starter(board, LILLARD);
    expect(lillard.designation).toBe("SUSPENSION");
    expect(lillard.options.length).toBeGreaterThan(0);
    for (const option of lillard.options) {
      expect(option).toMatchObject({ status: "review_required", reason: "suspension" });
    }
  });

  webDbTest(
    "shows a starter's request this week instead of options, and marks its replacement taken",
    async ({ database }) => {
      scripted("two-out-starters");
      const requestId = await insertInventedRequest(database.connection.db);

      const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

      expect(starter(board, LILLARD)).toMatchObject({
        request: { requestId, status: "needs_review", replacementName: "Jeremiah Fears" },
        options: [],
      });
      expect(starter(board, TATUM).options.find((option) => option.playerId === FEARS)).toBe(
        undefined
      );
      const tatumAll = starter(boardOf(await loadTeamBoard({ teamId: 1, revealAll: true })), TATUM);
      expect(tatumAll.options.find((option) => option.playerId === FEARS)).toMatchObject({
        status: "not_valid",
        reason: "taken",
        takenFor: "Damian Lillard",
      });
    }
  );

  for (const status of ["completed", "reversed"] as const) {
    webDbTest(
      `classifies a bench player a ${status} request named like any other bench player`,
      async ({ database }) => {
        scripted("two-out-starters");
        await insertInventedRequest(database.connection.db, { status, reviewReason: null });

        const tatum = starter(boardOf(await loadTeamBoard({ teamId: 1, revealAll: true })), TATUM);

        expect(tatum.options.find((option) => option.playerId === FEARS)).toMatchObject({
          status: "ready_now",
          reason: null,
          takenFor: null,
        });
      }
    );
  }

  webDbTest("offers options again after a request was rejected", async ({ database }) => {
    scripted("one-out-starter");
    await insertInventedRequest(database.connection.db, { status: "rejected", reviewReason: null });

    const lillard = starter(boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })), LILLARD);

    expect(lillard.request).toBeNull();
    expect(lillard.options.length).toBeGreaterThan(0);
  });

  webDbTest("says ESPN isn't connected yet in none mode", async () => {
    webEspnFor(createEspnReadClient({ mode: "none" }));

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "not_connected",
    });
  });

  webDbTest("says the app can't reach ESPN when ESPN refuses its credentials", async () => {
    scripted("credentials-rejected");

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "credentials_rejected",
    });
  });

  webDbTest("says InjurySub's own service is down when the worker doesn't answer", async () => {
    refusingWith("worker_unreachable");

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "worker_down",
    });
  });

  webDbTest("offers nothing once the season's last week has concluded", async () => {
    scripted("week-concluded");

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "season_over",
    });
  });
});

// The read's matchup replaced: team 1 at home or away against team 7.
function withMatchup(
  mine: Partial<MatchupSide>,
  opponent: Partial<MatchupSide> | null,
  home = true
) {
  return (read: TeamWeekRead): TeamWeekRead => {
    const side = (teamId: number, fields: Partial<MatchupSide>): MatchupSide => ({
      teamId,
      score: 0,
      adjustment: 0,
      adjustmentReason: null,
      creditedPlayers: [],
      ...fields,
    });
    const ours = side(1, mine);
    const theirs = opponent === null ? null : side(7, opponent);
    const matchupId = read.matchup?.matchupId ?? 7;
    if (!home && theirs !== null)
      return { ...read, matchup: { matchupId, home: theirs, away: ours } };
    return { ...read, matchup: { matchupId, home: ours, away: theirs } };
  };
}

function withWeek(fields: Partial<TeamWeekRead["week"]>, rest: Partial<TeamWeekRead> = {}) {
  return (read: TeamWeekRead): TeamWeekRead => ({
    ...read,
    ...rest,
    week: { ...read.week, ...fields },
  });
}

// One player's lines this week set to these points by day (active when he started), and none on
// the other days.
function withLines(playerId: number, byDay: Record<number, number>, active = true) {
  const line = (fantasyPoints: number) => ({
    fantasyPoints,
    points: 10,
    rebounds: 2,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 1,
  });
  return (read: TeamWeekRead): TeamWeekRead => ({
    ...read,
    days: read.days.map((day) => ({
      ...day,
      players: day.players.map((each) => {
        if (each.playerId !== playerId) return each;
        const points = byDay[day.scoringPeriodId];
        return points === undefined
          ? { ...each, line: null }
          : { ...each, active, line: line(points) };
      }),
    })),
  });
}

function both(...changes: ReadChange[]): ReadChange {
  return (read) => changes.reduce((each, change) => change(each), read);
}

function rowOf(rows: readonly BoardRosterRow[], playerId: number): BoardRosterRow {
  const found = rows.find((row) => row.player?.playerId === playerId);
  if (found === undefined) throw new Error(`no row for ${playerId}`);
  return found;
}

describe("loadTeamBoard: the matchup and the week", () => {
  webDbTest(
    "shows the week by number and dates, and each side's name, total and live points",
    async () => {
      for (const home of [true, false]) {
        scripted(
          "one-out-starter",
          withMatchup(
            { score: 412.5, livePoints: 31.2, teamName: "Team One Name" },
            { score: 398.1, livePoints: null, teamName: "Rivals" },
            home
          )
        );

        const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

        expect(board.week).toEqual({
          matchupPeriodId: 2,
          playoffs: false,
          firstDate: "2026-10-26",
          lastDate: "2026-11-01",
          afterLastGame: false,
        });
        expect(board.matchup).toEqual({
          mine: { teamId: 1, name: "Team One Name", total: 412.5, livePoints: 31.2 },
          opponent: { teamId: 7, name: "Rivals", total: 398.1, livePoints: null },
        });
      }
    }
  );

  webDbTest(
    "names the team's own side by its lineup when the read didn't, and an older worker's missing live points as none",
    async () => {
      scripted("one-out-starter", withMatchup({ score: 10 }, { score: 12 }));

      const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

      expect(board.matchup?.mine).toEqual({
        teamId: 1,
        name: board.teamName,
        total: 10,
        livePoints: null,
      });
      expect(board.matchup?.opponent).toEqual({
        teamId: 7,
        name: null,
        total: 12,
        livePoints: null,
      });
    }
  );

  webDbTest("reads a playoff week, and a side with no opponent as a bye", async () => {
    scripted(
      "one-out-starter",
      both(withWeek({ matchupPeriodId: 19 }), withMatchup({ score: 50 }, null))
    );

    const board = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

    expect(board.week.playoffs).toBe(true);
    expect(board.matchup?.opponent).toBeNull();
  });

  webDbTest(
    "says the week's last game has ended once ESPN's day is the last and its latest tip is long past",
    async () => {
      const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
      scripted(
        "one-out-starter",
        withWeek({ todayScoringPeriodId: 13 }, { lastDayLatestTipAt: hoursAgo(5) })
      );
      expect(boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })).week.afterLastGame).toBe(
        true
      );

      scripted(
        "one-out-starter",
        withWeek({ todayScoringPeriodId: 13 }, { lastDayLatestTipAt: hoursAgo(1) })
      );
      expect(boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })).week.afterLastGame).toBe(
        false
      );
    }
  );
});

describe("loadTeamBoard: the roster", () => {
  webDbTest(
    "lists every slot in ESPN's order, each player's week, average, designation and games",
    async () => {
      const read = await createEspnReadClient({
        mode: "scripted",
        scenario: "one-out-starter",
      }).getTeamWeek(1);
      scriptedWithScoreboard(async () => [BKN_AT_BOS], withLines(EDEY, { 7: 12.5 }, false));

      const { roster } = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

      expect(roster.starters.map((row) => row.slot)).toEqual(
        read.lineup.starters.map((slot) => slot.slot)
      );
      expect(roster.bench.map((row) => row.player?.playerId)).toEqual(BENCH);
      expect(roster.injuredReserve.map((row) => row.player?.designation ?? null)).toEqual([
        "OUT",
        "OUT",
        null,
      ]);
      expect(rowOf(roster.starters, LILLARD).player?.designation).toBe("OUT");

      const edey = rowOf(roster.bench, EDEY).player;
      const edeyOutlook = read.players.find((each) => each.playerId === EDEY);
      expect(edey).toMatchObject({
        name: "Zach Edey",
        weekPoints: 12.5,
        seasonAveragePoints: edeyOutlook?.seasonAveragePoints,
        nextGame: edeyOutlook?.nextGame,
        todaysGame: null,
        gameState: null,
      });

      const sharpe = rowOf(roster.bench, SHARPE).player;
      expect(sharpe?.gameState).toEqual(BKN_AT_BOS);
      expect(sharpe?.todaysGame?.scoringPeriodId).toBe(8);
    }
  );

  webDbTest(
    "gives an OUT starter's points by day while he started, and his options counted each way",
    async () => {
      scripted("one-out-starter", both(withLines(LILLARD, { 7: 30.5, 8: 12 })));

      const lillard = starter(
        boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })),
        LILLARD
      );

      expect(lillard.startingDays).toEqual([
        { scoringPeriodId: 7, date: "2026-10-26", points: 30.5 },
        { scoringPeriodId: 8, date: "2026-10-27", points: 12 },
      ]);
      const { readyNow, review, notValid } = lillard.optionCounts;
      expect(readyNow + review + notValid).toBe(BENCH.length);
      expect(readyNow).toBe(lillard.options.filter((each) => each.status === "ready_now").length);
    }
  );

  webDbTest(
    "shows a starter's request with its amount and when it was asked",
    async ({ database }) => {
      scripted("one-out-starter");
      const filedAt = new Date("2026-10-28T01:00:00.000Z");
      await insertInventedRequest(database.connection.db, {
        projectedAdjustmentTenths: -878,
        filedAt,
      });

      const lillard = starter(
        boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })),
        LILLARD
      );

      expect(lillard.request).toMatchObject({
        replacementName: "Jeremiah Fears",
        injuredName: "Damian Lillard",
        amountTenths: -878,
        filedAt,
      });
    }
  );
});

describe("loadTeamBoard: when it can't read everything", () => {
  webDbTest("shows the last read, marked stale, when ESPN can't be reached", async () => {
    scriptedWithScoreboard(async () => [BKN_AT_BOS]);
    const fresh = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));
    refusingWith("espn_unavailable");

    const stale = boardOf(await loadTeamBoard({ teamId: 1, revealAll: false }));

    expect(stale.stale).toBe(true);
    expect(stale.readAt).toBe(fresh.readAt);
    expect(rowOf(stale.roster.bench, SHARPE).player?.gameState).toBeNull();
    expect(fresh.stale).toBe(false);
  });

  webDbTest("says ESPN can't be reached when it has read nothing earlier", async () => {
    forgetLastReads();
    refusingWith("espn_unavailable");

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "unavailable",
    });
  });

  webDbTest(
    "says the database is down, never ESPN, when the requests can't be read",
    async ({ webLog }) => {
      scripted("one-out-starter");
      globalThis.__injurysubWebDb = createWebDatabaseConnection(
        `postgres://postgres:postgres@${process.env.PGHOST}:1/injurysub`
      );

      expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
        status: "database_down",
      });
      expect(webLog.events()).toContainEqual(
        expect.objectContaining({ event: "web.board.database_failed" })
      );
    }
  );
});
