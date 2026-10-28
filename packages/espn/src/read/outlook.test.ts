import { readFileSync } from "node:fs";
import { calculateFantasyPoints } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import { createEspnClient } from "../client";
import { createReadClient } from "./client";
import type { DayLine, LineupPlayer, MatchupWeek, TeamDay, TeamLineup } from "./contracts";
import { EspnError } from "./errors";
import { seasonStatsSchema } from "./league";
import {
  PRO_SCHEDULE_VIEWS,
  playerOutlooksOf,
  proScheduleResponseSchema,
  seasonAverageOf,
} from "./outlook";
import { loadCommittedRecordings } from "./recordings";
import { createRecordedSource, type Recordings, requestKey } from "./source";
import {
  DAY_MEMBERSHIP_VIEWS,
  dayMembershipResponseSchema,
  WEEK_VIEWS,
  weekResponseSchema,
} from "./week";

const seasonAverageCheck = JSON.parse(
  readFileSync(new URL("./__fixtures__/season-average-check.json", import.meta.url), "utf8")
);

// A made-up week 2: days 7 to 13, with 7 and 8 complete and 9 today.
const week: MatchupWeek = {
  matchupPeriodId: 2,
  scoringPeriodIds: [7, 8, 9, 10, 11, 12, 13],
  completeScoringPeriodIds: [7, 8],
  todayScoringPeriodId: 9,
  matchups: [],
};

function lineupPlayer(playerId: number, proTeamId: number): LineupPlayer {
  return {
    playerId,
    name: `Player ${playerId}`,
    proTeamId,
    eligibleSlots: ["C", "UTIL", "BE", "IR"],
    designation: { status: "ACTIVE" },
    lineupLocked: true,
  };
}

// Player 3001 plays for NBA team 11; player 3002 is on no NBA team (0).
const lineup: TeamLineup = {
  teamId: 3,
  teamName: "Team 3",
  starters: [{ slot: "C", player: lineupPlayer(3001, 11) }],
  bench: [
    { slot: "BE", player: lineupPlayer(3002, 0) },
    { slot: "BE", player: null },
  ],
  injuredReserve: [],
};

const line = (fantasyPoints: number, points: number): DayLine => ({
  fantasyPoints,
  points,
  rebounds: 2,
  assists: 1,
  steals: 0,
  blocks: 1,
  turnovers: 1,
});

function teamDay(scoringPeriodId: number, active: boolean, playerLine: DayLine | null): TeamDay {
  return {
    teamId: 3,
    scoringPeriodId,
    players: [
      {
        playerId: 3001,
        name: "Player 3001",
        slot: active ? "C" : "BE",
        active,
        lineupLocked: true,
        line: playerLine,
      },
    ],
  };
}

const at = (iso: string) => Date.parse(iso);

// NBA team 11 is at home on day 8, away on day 10 and at home on day 16, next week.
const schedule = proScheduleResponseSchema.parse({
  settings: {
    proTeams: [
      { id: 0, abbrev: "FA", proGamesByScoringPeriod: {} },
      { id: 5, abbrev: "CLE" },
      {
        id: 11,
        abbrev: "IND",
        proGamesByScoringPeriod: {
          "8": [{ date: at("2026-10-27T23:00:00Z"), homeProTeamId: 11, awayProTeamId: 3 }],
          "10": [{ date: at("2026-10-29T23:30:00Z"), homeProTeamId: 5, awayProTeamId: 11 }],
          "16": [{ date: at("2026-11-04T23:00:00Z"), homeProTeamId: 11, awayProTeamId: 5 }],
        },
      },
    ],
  },
});

const readName = "team 3's player outlook";

function outlooks(completeDays: readonly TeamDay[]) {
  const seasonAverages = new Map([
    [3001, 33.3],
    [3002, null],
  ]);
  return playerOutlooksOf({ lineup, seasonAverages, completeDays, week, schedule, readName });
}

function thrownBy(action: () => unknown): EspnError {
  try {
    action();
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected an EspnError");
}

describe("the player outlook", () => {
  it("sums a player's complete days into his week-to-date line, and credits only his active days", () => {
    const [player] = outlooks([teamDay(7, true, line(20.5, 10)), teamDay(8, false, line(12, 6))]);

    expect(player).toMatchObject({
      playerId: 3001,
      weekToDate: {
        fantasyPoints: 32.5,
        points: 16,
        rebounds: 4,
        assists: 2,
        steals: 0,
        blocks: 2,
        turnovers: 2,
      },
      creditedPoints: 20.5,
      seasonAveragePoints: 33.3,
    });
  });

  it("counts his NBA team's games from today to the week's end, and names the next one", () => {
    const [player] = outlooks([]);

    expect(player).toMatchObject({
      gamesLeft: 1,
      nextGame: {
        scoringPeriodId: 10,
        date: "2026-10-29T23:30:00.000Z",
        opponentProTeamId: 5,
        opponent: "CLE",
        home: false,
      },
    });
  });

  it("gives a player on no NBA team no games, and a player with no lines zeros", () => {
    const [, player] = outlooks([teamDay(7, true, line(20.5, 10))]);

    expect(player).toEqual({
      playerId: 3002,
      name: "Player 3002",
      proTeamId: 0,
      seasonAveragePoints: null,
      weekToDate: {
        fantasyPoints: 0,
        points: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
      },
      creditedPoints: 0,
      gamesLeft: 0,
      nextGame: null,
    });
  });

  it("lists every rostered player once, and no empty slot", () => {
    expect(outlooks([]).map((player) => player.playerId)).toEqual([3001, 3002]);
  });

  // Either would otherwise read as no games left. ESPN lists FA (team 0) with an empty map, so the
  // player on no NBA team above still has no games.
  it.each([
    ["isn't in the NBA schedule", 7, /player 3003's NBA team 7 isn't in ESPN's NBA schedule/],
    ["is in it without its games", 5, /player 3003's NBA team 5 is listed without its games/],
  ])("refuses a player whose NBA team %s, rather than giving him no games", (_, proTeamId, message) => {
    const withPlayer: TeamLineup = {
      ...lineup,
      starters: [{ slot: "C", player: lineupPlayer(3003, proTeamId) }],
    };

    const failure = thrownBy(() =>
      playerOutlooksOf({
        lineup: withPlayer,
        seasonAverages: new Map(),
        completeDays: [],
        week,
        schedule,
        readName,
      })
    );

    expect(failure.code).toBe("unrecognized_response");
    expect(failure.message).toMatch(message);
  });
});

describe("the season average", () => {
  const entries = seasonStatsSchema.parse(seasonAverageCheck.espnSeasonEntries);

  it("is ESPN's average for the league's season, never last season's", () => {
    expect(seasonAverageOf(entries, 2027)).toBe(40.4);
    expect(seasonAverageOf(entries, 2028)).toBeNull();
  });

  // The fixture pins what split 0 is, independently of any recapture.
  it("is the player's box scores averaged under the league formula, his season to date", () => {
    type BoxScore = Record<
      "points" | "rebounds" | "assists" | "steals" | "blocks" | "turnovers",
      number
    >;
    const boxScores: BoxScore[] = seasonAverageCheck.boxScores;
    const gamePoints = boxScores.map((box) =>
      calculateFantasyPoints({
        pts: box.points,
        reb: box.rebounds,
        ast: box.assists,
        stl: box.steals,
        blk: box.blocks,
        tov: box.turnovers,
      })
    );
    const average = gamePoints.reduce((sum, points) => sum + points, 0) / gamePoints.length;
    expect(Math.round((seasonAverageOf(entries, 2027) ?? 0) * 10)).toBe(Math.round(average * 10));

    const total = (stat: keyof BoxScore) => boxScores.reduce((sum, box) => sum + box[stat], 0);
    expect(seasonAverageCheck.espnSeasonEntries[1].stats).toEqual({
      "0": total("points"),
      "1": total("blocks"),
      "2": total("steals"),
      "3": total("assists"),
      "6": total("rebounds"),
      "11": total("turnovers"),
    });
  });
});

// The committed recording of the real league.
describe("the recorded player outlook", () => {
  async function recordedOutlook() {
    const client = createEspnClient({ mode: "stub" });
    const { teams } = await client.getLineups();
    const [team] = teams;
    if (!team) throw new Error("the recording has no team");
    const { week: recordedWeek } = await client.getCurrentWeek();
    const days = await Promise.all(
      recordedWeek.completeScoringPeriodIds.map((day) => client.getTeamDay(team.teamId, day))
    );
    const read = await client.getPlayerOutlook(team.teamId);
    return { team, recordedWeek, days: days.map((each) => each.day), read };
  }

  it("gives each rostered player his complete days' lines summed, and credits his active ones", async () => {
    const { team, days, read } = await recordedOutlook();

    const rostered = [...team.starters, ...team.bench, ...team.injuredReserve].flatMap((slot) =>
      slot.player ? [slot.player.playerId] : []
    );
    expect(read.meta.source).toBe("recorded");
    expect(read.players.map((player) => player.playerId)).toEqual(rostered);
    for (const player of read.players) {
      const played = days.flatMap((day) =>
        day.players.filter((each) => each.playerId === player.playerId && each.line)
      );
      const sum = (pick: (each: (typeof played)[number]) => number) =>
        Math.round(played.reduce((total, each) => total + pick(each), 0) * 10) / 10;
      expect(Math.round(player.weekToDate.fantasyPoints * 10) / 10).toBe(
        sum((each) => each.line?.fantasyPoints ?? 0)
      );
      expect(player.weekToDate.points).toBe(sum((each) => each.line?.points ?? 0));
      expect(Math.round(player.creditedPoints * 10) / 10).toBe(
        sum((each) => (each.active ? (each.line?.fantasyPoints ?? 0) : 0))
      );
    }
  });

  it("matches each player's games left and next game to his NBA team's recorded schedule", async () => {
    const { recordedWeek, read } = await recordedOutlook();
    const recordings = await loadCommittedRecordings();
    const body = recordings.responses.get(
      requestKey({ kind: "pro-schedule", views: PRO_SCHEDULE_VIEWS })
    );
    if (body === undefined) throw new Error("the recording holds no NBA schedule");
    const { proTeams } = proScheduleResponseSchema.parse(body).settings;
    const today = recordedWeek.todayScoringPeriodId;
    const lastDay = Math.max(...recordedWeek.scoringPeriodIds);

    for (const player of read.players) {
      const games = Object.entries(
        proTeams.find((team) => team.id === player.proTeamId)?.proGamesByScoringPeriod ?? {}
      ).filter(([, dayGames]) => dayGames.length > 0);
      const left = games.filter(([day]) => Number(day) >= today && Number(day) <= lastDay);
      expect(player.gamesLeft).toBe(
        left.reduce((count, [, dayGames]) => count + dayGames.length, 0)
      );
      const next = games
        .map(([day]) => Number(day))
        .filter((day) => day >= today)
        .sort((a, b) => a - b)[0];
      expect(player.nextGame?.scoringPeriodId ?? null).toBe(next ?? null);
    }
    expect(read.players.some((player) => player.nextGame !== null)).toBe(true);
  });

  it("says when a team isn't in the league", async () => {
    await expect(createEspnClient({ mode: "stub" }).getPlayerOutlook(999)).rejects.toMatchObject({
      code: "team_not_found",
      message: expect.stringMatching(/\bteam 999\b/),
    });
  });

  // The recording with its week moved back to the first day, which leaves no complete day. Every
  // day of a week is in one matchup period, so a day it doesn't hold is answered as one it does.
  async function recordingOnTheWeeksFirstDay(): Promise<Recordings> {
    const recordings = await loadCommittedRecordings();
    const recorded = createReadClient(createRecordedSource(async () => recordings));
    const { scoringPeriodIds } = (await recorded.getCurrentWeek()).week;
    const membership = (day: number) =>
      requestKey({ kind: "league", views: DAY_MEMBERSHIP_VIEWS, scoringPeriodId: day });
    const [firstDay] = scoringPeriodIds;
    const heldDay = scoringPeriodIds.find((day) => recordings.responses.has(membership(day)));
    if (firstDay === undefined || heldDay === undefined) throw new Error("no day of the week held");
    const sameWeek = dayMembershipResponseSchema.parse(
      recordings.responses.get(membership(heldDay))
    );
    const weekKey = requestKey({ kind: "league", views: WEEK_VIEWS });
    const week = weekResponseSchema.parse(recordings.responses.get(weekKey));
    const responses = new Map(recordings.responses).set(weekKey, {
      ...week,
      scoringPeriodId: firstDay,
    });
    for (const day of scoringPeriodIds) {
      if (!responses.has(membership(day))) {
        responses.set(membership(day), { ...sameWeek, scoringPeriodId: day });
      }
    }
    return { ...recordings, responses };
  }

  // While the week has a complete day, the day read refuses an unknown team with the same error.
  // With none, only the outlook's own check can.
  it("says so on the week's first day too, with no complete day to read", async () => {
    const recordings = await recordingOnTheWeeksFirstDay();
    const client = createReadClient(createRecordedSource(async () => recordings));

    const { week } = await client.getCurrentWeek();
    expect(week.completeScoringPeriodIds).toEqual([]);
    await expect(client.getPlayerOutlook(999)).rejects.toMatchObject({
      code: "team_not_found",
      message: expect.stringMatching(/\bteam 999\b/),
    });
  });
});
