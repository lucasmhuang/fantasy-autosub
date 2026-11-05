import { afterEach, describe, expect, it, vi } from "vitest";
import { createEspnReadClient } from "../client";
import { createReadClient } from "./client";
import { EspnError } from "./errors";
import type { ProSchedule } from "./outlook";
import { loadCommittedRecordings } from "./recordings";
import { createRecordedSource, type Recordings, requestKey } from "./source";
import { lastDayLatestTipOf } from "./team-week";
import { WEEK_VIEWS } from "./week";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function rejectionOf(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

// The committed recordings (captured on day 8, Tue 2026-10-27, in week 2: days 7-13).
describe("getTeamWeek on the recorded league", () => {
  it("gives team 1's lineup, week, matchup, day lines through today and outlook in one read", async () => {
    const read = await createEspnReadClient({ mode: "stub" }).getTeamWeek(1);

    expect(read.teamId).toBe(1);
    expect(read.lineup.teamId).toBe(1);
    expect(read.week.scoringPeriodIds).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(read.week.todayScoringPeriodId).toBe(8);
    expect(read.days.map((day) => [day.teamId, day.scoringPeriodId])).toEqual([
      [1, 7],
      [1, 8],
    ]);
    expect([read.matchup?.home.teamId, read.matchup?.away?.teamId]).toContain(1);
    expect(read.players.map((player) => player.playerId)).toEqual(
      [...read.lineup.starters, ...read.lineup.bench, ...read.lineup.injuredReserve].flatMap(
        (slot) => (slot.player ? [slot.player.playerId] : [])
      )
    );
    expect(read.lastDayLatestTipAt).toMatch(/^2026-11-0[12]T/);
    expect(read.meta.source).toBe("recorded");
  });

  it("refuses a team that isn't in the league", async () => {
    expect((await rejectionOf(createEspnReadClient({ mode: "stub" }).getTeamWeek(13))).code).toBe(
      "team_not_found"
    );
  });

  it("gives a team on a bye its matchup with no opponent", async () => {
    const recordings = await recordingsWithTeamOneOnBye();
    const read = await createReadClient(createRecordedSource(async () => recordings)).getTeamWeek(
      1
    );

    expect(read.matchup).toMatchObject({ home: { teamId: 1 }, away: null });
  });
});

describe("lastDayLatestTipOf", () => {
  const schedule = (games: Record<string, { date: number }[]>): ProSchedule => ({
    settings: {
      proTeams: [
        {
          id: 1,
          abbrev: "ATL",
          proGamesByScoringPeriod: Object.fromEntries(
            Object.entries(games).map(([day, list]) => [
              day,
              list.map(({ date }) => ({ date, homeProTeamId: 1, awayProTeamId: 2 })),
            ])
          ),
        },
        { id: 0, abbrev: "FA", proGamesByScoringPeriod: {} },
      ],
    },
  });

  it("gives the latest tip time among the day's games", () => {
    const early = Date.parse("2026-11-01T20:00:00Z");
    const late = Date.parse("2026-11-02T02:30:00Z");

    expect(lastDayLatestTipOf(schedule({ "13": [{ date: early }, { date: late }] }), 13)).toBe(
      "2026-11-02T02:30:00.000Z"
    );
  });

  it("gives null for a day with no games", () => {
    expect(
      lastDayLatestTipOf(schedule({ "12": [{ date: Date.parse("2026-11-01T20:00:00Z") }] }), 13)
    ).toBeNull();
  });
});

describe("the ESPN client without credentials", () => {
  it("refuses every read as not connected, sending no request", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(String(url));
      throw new Error("no request expected");
    });
    const client = createEspnReadClient({ mode: "none" });

    const reads = [
      client.getLineups(),
      client.getLineup(1),
      client.getCurrentWeek(),
      client.getTeamDay(1, 8),
      client.getTeamWeek(1),
      client.checkCredentials(),
      client.checkLeagueRules(),
      client.getPlayerOutlook(1),
    ];
    const codes = await Promise.all(reads.map(async (read) => (await rejectionOf(read)).code));

    expect(client.mode).toBe("none");
    expect(new Set(codes)).toEqual(new Set(["not_connected"]));
    expect(requested).toEqual([]);
  });
});

// The committed recordings with team 1's current matchup turned into a bye: team 1 at home and
// no away side.
async function recordingsWithTeamOneOnBye(): Promise<Recordings> {
  const recordings = await loadCommittedRecordings();
  const key = requestKey({ kind: "league", views: WEEK_VIEWS });
  const week = structuredClone(recordings.responses.get(key)) as {
    status: { currentMatchupPeriod: number };
    schedule: { matchupPeriodId: number; home: { teamId: number }; away?: { teamId: number } }[];
  };
  const entry = week.schedule.find(
    (candidate) =>
      candidate.matchupPeriodId === week.status.currentMatchupPeriod &&
      (candidate.home.teamId === 1 || candidate.away?.teamId === 1)
  )!;
  if (entry.away?.teamId === 1) entry.home = entry.away;
  delete entry.away;
  const responses = new Map(recordings.responses);
  responses.set(key, week);
  return { ...recordings, responses };
}
