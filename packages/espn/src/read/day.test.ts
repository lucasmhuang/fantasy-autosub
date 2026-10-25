import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEspnClient } from "../client";
import { createReadClient } from "./client";
import { DAY_VIEWS } from "./day";
import { EspnError } from "./errors";
import { createRecordedSource, requestKey } from "./source";

const boxScoreCheck = JSON.parse(
  readFileSync(new URL("./__fixtures__/box-score-check.json", import.meta.url), "utf8")
);

// Made-up players, shaped like ESPN's answer for one scoring period. A player's stats hold more
// than the day's line (season, recent days, projections), which the read must ignore.
function stat(
  statSplitTypeId: number,
  scoringPeriodId: number,
  appliedTotal: number,
  statSourceId = 0
) {
  return {
    statSplitTypeId,
    statSourceId,
    scoringPeriodId,
    seasonId: 2027,
    appliedTotal,
    stats: { "0": 10, "1": 1, "2": 2, "3": 3, "6": 6, "11": 1, "40": 31.5 },
  };
}

function entry(playerId: number, lineupSlotId: number, stats: unknown[], lineupLocked = true) {
  return {
    playerId,
    lineupSlotId,
    playerPoolEntry: {
      lineupLocked,
      player: { fullName: `Player ${playerId}`, proTeamId: 9, eligibleSlots: [4, 11, 12], stats },
    },
  };
}

function dayAnswer(day: number, entries: unknown[]) {
  return {
    seasonId: 2027,
    scoringPeriodId: day,
    status: { currentMatchupPeriod: 1 },
    teams: [
      { id: 3, roster: { entries } },
      { id: 4, roster: { entries: [] } },
    ],
  };
}

function readDay(teamId: number, day: number, answers: Record<number, unknown>) {
  const responses = new Map(
    Object.entries(answers).map(([answerDay, body]): [string, unknown] => [
      requestKey({ kind: "league", views: DAY_VIEWS, scoringPeriodId: Number(answerDay) }),
      body,
    ])
  );
  const recordings = { capturedAt: "2026-10-25T01:00:00.000Z", season: 2027, responses };
  return createReadClient(createRecordedSource(async () => recordings)).getTeamDay(teamId, day);
}

async function readFailure(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

const lineOf = (fantasyPoints: number) => ({
  fantasyPoints,
  points: 10,
  rebounds: 6,
  assists: 3,
  steals: 2,
  blocks: 1,
  turnovers: 1,
});

describe("a team's day", () => {
  it("lists who was active and locked, and each player's line for the day, bench players included", async () => {
    const answer = dayAnswer(2, [
      entry(301, 4, [
        stat(0, 0, 400),
        stat(1, 0, 90),
        stat(5, 1, 18),
        stat(5, 2, 24.5),
        stat(0, 0, 30, 1),
      ]),
      entry(302, 12, [stat(5, 2, 12)]),
      entry(303, 11, [stat(0, 0, 200), stat(5, 2, 30, 1)], false),
      entry(304, 13, []),
    ]);

    const read = await readDay(3, 2, { 2: answer });

    expect(read.meta).toMatchObject({ source: "recorded", scoringPeriodId: 2 });
    expect(read.day).toEqual({
      teamId: 3,
      scoringPeriodId: 2,
      players: [
        {
          playerId: 301,
          name: "Player 301",
          slot: "C",
          active: true,
          lineupLocked: true,
          line: lineOf(24.5),
        },
        {
          playerId: 302,
          name: "Player 302",
          slot: "BE",
          active: false,
          lineupLocked: true,
          line: lineOf(12),
        },
        {
          playerId: 303,
          name: "Player 303",
          slot: "UTIL",
          active: true,
          lineupLocked: false,
          line: null,
        },
        {
          playerId: 304,
          name: "Player 304",
          slot: "IR",
          active: false,
          lineupLocked: true,
          line: null,
        },
      ],
    });
  });

  it("maps ESPN's stat ids to the box score's stats", async () => {
    const { playerId, scoringPeriodId, espnDayLine, boxScore } = boxScoreCheck;
    const answer = dayAnswer(scoringPeriodId, [
      entry(playerId, 4, [
        { statSplitTypeId: 5, statSourceId: 0, scoringPeriodId, seasonId: 2027, ...espnDayLine },
      ]),
    ]);

    const read = await readDay(3, scoringPeriodId, { [scoringPeriodId]: answer });

    expect(read.day.players[0]?.line).toEqual({
      fantasyPoints: espnDayLine.appliedTotal,
      ...boxScore,
    });
  });

  it("says when the team isn't in the league", async () => {
    const error = await readFailure(readDay(999, 2, { 2: dayAnswer(2, []) }));

    expect(error.code).toBe("team_not_found");
  });

  it("gives no line to a player whose team played but who recorded nothing", async () => {
    const didNotPlay = { ...stat(5, 2, 0), stats: {} };

    const read = await readDay(3, 2, { 2: dayAnswer(2, [entry(301, 4, [didNotPlay])]) });

    expect(read.day.players[0]?.line).toBeNull();
  });

  it("refuses a day line missing one of the counted stats", async () => {
    const partial = { ...stat(5, 2, 24.5), stats: { "0": 10, "1": 1, "2": 2, "3": 3, "6": 6 } };

    const error = await readFailure(readDay(3, 2, { 2: dayAnswer(2, [entry(301, 4, [partial])]) }));

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/11/);
  });

  it("refuses a team ESPN sent no roster for", async () => {
    const answer = { ...dayAnswer(2, []), teams: [{ id: 3 }] };

    const error = await readFailure(readDay(3, 2, { 2: answer }));

    expect(error.code).toBe("unrecognized_response");
  });

  it("refuses a day the recording doesn't hold", async () => {
    const error = await readFailure(readDay(3, 3, { 2: dayAnswer(2, []) }));

    expect(error.code).toBe("not_recorded");
  });
});

// The committed recording of the real league: every complete day, today and tomorrow (when it's
// still in the week) are recorded.
describe("the recorded days", () => {
  it("give every player who played on a complete day a full line, bench players included", async () => {
    const client = createEspnClient({ mode: "stub" });
    const { week } = await client.getCurrentWeek();
    const { teams } = await client.getLineups();

    const days = await Promise.all(
      week.completeScoringPeriodIds.flatMap((day) =>
        teams.map((team) => client.getTeamDay(team.teamId, day))
      )
    );

    const lines = days.flatMap(({ day }) =>
      day.players.flatMap((player) => (player.line ? [player] : []))
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const player of lines) {
      expect(Object.values(player.line ?? {}).every(Number.isFinite)).toBe(true);
    }
    expect(lines.some((player) => player.slot === "BE")).toBe(true);
  });

  it("show today's lineup as it stands, and tomorrow's as set, when tomorrow is in the week", async () => {
    const client = createEspnClient({ mode: "stub" });
    const { week } = await client.getCurrentWeek();
    const { teams } = await client.getLineups();
    const [team] = teams;
    if (!team) throw new Error("the recording has no team");

    const today = await client.getTeamDay(team.teamId, week.todayScoringPeriodId);

    expect(today.day.players.length).toBeGreaterThan(0);
    const tomorrow = week.todayScoringPeriodId + 1;
    if (week.scoringPeriodIds.includes(tomorrow)) {
      const next = await client.getTeamDay(team.teamId, tomorrow);
      expect(next.day.players.every((player) => player.line === null)).toBe(true);
    }
  });
});
