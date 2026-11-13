import { planLineupEdit, routeRequest } from "@injurysub/domain";
import { createEspnReadClient, type EspnError, type ScenarioName } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { type BoardStarter, loadTeamBoard, type TeamBoard } from "./board";
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

function refusingWith(code: EspnError["code"]): void {
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

describe("loadTeamBoard: the rehearsal bar", () => {
  webDbTest.for([
    { sendMode: "never", rehearsal: true },
    { sendMode: "live", rehearsal: false },
  ] as const)(
    "says $rehearsal while the worker's send mode is $sendMode",
    async ({ sendMode, rehearsal }) => {
      setWebEspn(
        createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }),
        undefined,
        sendMode
      );

      expect(boardOf(await loadTeamBoard({ teamId: 1, revealAll: false })).rehearsal).toBe(
        rehearsal
      );
    }
  );
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

  webDbTest("says ESPN can't be reached when the worker doesn't answer", async () => {
    refusingWith("worker_unreachable");

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "unavailable",
    });
  });

  webDbTest("offers nothing once the season's last week has concluded", async () => {
    scripted("week-concluded");

    expect(await loadTeamBoard({ teamId: 1, revealAll: false })).toEqual({
      status: "season_over",
    });
  });
});
