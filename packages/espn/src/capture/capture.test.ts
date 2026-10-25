import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadClient } from "../read/client";
import { EspnError } from "../read/errors";
import { recordingsFromFiles } from "../read/recordings";
import { createRecordedSource } from "../read/source";
import { captureRecordings, RECORDING_FILES } from "./capture";

// Synthetic values only. No real member, team or league value ever belongs in this file.
const leagueId = 4567123;
const ownerId = "{A1B2C3D4-1111-4111-8111-0000000000AA}";
const rivalId = "{B1B2C3D4-2222-4222-8222-0000000000BB}";
const credentials = { espnS2: `AEB${"q".repeat(160)}%2Bsynthetic%3D`, swid: ownerId };
const lineupSlotCounts = { "4": 1, "5": 3, "12": 4, "13": 3 };
const capturedAt = new Date("2026-10-25T03:00:00.000Z");

function rawPlayer(playerId: number, fullName: string, injuryStatus: string) {
  const [firstName, lastName] = fullName.split(" ");
  return {
    playerId,
    lineupSlotId: 4,
    injuryStatus: "NORMAL",
    pendingTransactionIds: ["{E1E2E3E4-5555-4555-8555-0000000000EE}"],
    playerPoolEntry: {
      lineupLocked: true,
      rosterLocked: true,
      player: {
        fullName,
        firstName,
        lastName,
        proTeamId: 9,
        eligibleSlots: [4, 11, 12, 13],
        injuryStatus,
        stats: [{ appliedTotal: 41.5, statSplitTypeId: 0 }],
      },
    },
  };
}

// ESPN's raw answer to the lineup request, with the identifying and private fields a real one has.
function rawLeague(rivalPlayerName = "Blake Example") {
  return {
    gameId: 3,
    id: leagueId,
    seasonId: 2027,
    segmentId: 0,
    scoringPeriodId: 5,
    draftDetail: { drafted: true },
    settings: {
      name: "Synthetic Hoops League",
      rosterSettings: { lineupSlotCounts, moveLimit: -1 },
    },
    status: { currentMatchupPeriod: 1, creationInfo: { clientAddress: null, source: ownerId } },
    members: [
      {
        id: ownerId,
        firstName: "Anthony",
        lastName: "Q",
        displayName: "hoops_q",
        notificationSettings: [],
      },
      {
        id: rivalId,
        firstName: "Kit",
        lastName: "Marlowe",
        displayName: "kitm",
        notificationSettings: [],
      },
    ],
    teams: [
      {
        id: 7,
        name: "Q Dynasty",
        abbrev: "QDY",
        logo: "https://example.com/q.png",
        owners: [ownerId],
        primaryOwner: ownerId,
        watchList: [3001],
        pendingTransactions: [{ bidAmount: 7, memberId: ownerId }],
        draftStrategy: { draftList: [3001] },
        roster: { entries: [rawPlayer(3001, "Avery Example", "OUT")] },
      },
      {
        id: 3,
        name: "River City",
        abbrev: "RVC",
        owners: [rivalId],
        primaryOwner: rivalId,
        roster: { entries: [rawPlayer(3002, rivalPlayerName, "ACTIVE")] },
      },
    ],
  };
}

const espnFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function rawSide(teamId: number, playerId: number) {
  return {
    teamId,
    totalPoints: 50,
    totalPointsLive: 50,
    adjustment: 0,
    pointsByScoringPeriod: { "1": 20, "2": 30 },
    rosterForMatchupPeriod: {
      appliedStatTotal: 50,
      entries: [
        {
          playerId,
          lineupSlotId: 4,
          injuryStatus: "NORMAL",
          playerPoolEntry: {
            appliedStatTotal: 50,
            lineupLocked: true,
            player: { fullName: "Avery Example" },
          },
        },
      ],
    },
  };
}

// ESPN's raw answer to the week request: the season's schedule, with week 1 in progress on day 5.
function rawWeek() {
  return {
    gameId: 3,
    id: leagueId,
    seasonId: 2027,
    segmentId: 0,
    scoringPeriodId: 5,
    status: { currentMatchupPeriod: 1, firstScoringPeriod: 1, finalScoringPeriod: 153 },
    schedule: [
      { id: 1, matchupPeriodId: 1, home: rawSide(7, 3001), away: rawSide(3, 3002) },
      {
        id: 7,
        matchupPeriodId: 2,
        home: { teamId: 7, totalPoints: 0 },
        away: { teamId: 3, totalPoints: 0 },
      },
    ],
  };
}

// ESPN's raw answer for one day: days 1 to 6 are week 1, and day 7 starts week 2.
function rawDay(day: number) {
  const marked = (period: number) =>
    day <= 6 === (period === 1) ? { rosterForCurrentScoringPeriod: { entries: [] } } : {};
  return {
    gameId: 3,
    id: leagueId,
    seasonId: 2027,
    segmentId: 0,
    scoringPeriodId: day,
    status: { currentMatchupPeriod: 1 },
    schedule: [1, 2].map((period) => ({
      id: period === 1 ? 1 : 7,
      matchupPeriodId: period,
      home: { teamId: 7, totalPoints: 0, ...marked(period) },
      away: { teamId: 3, totalPoints: 0 },
    })),
  };
}

function serve(options: { currentSeasonId?: number; league?: unknown } = {}) {
  espnFetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/games/fba")) {
      return Response.json({ currentSeasonId: options.currentSeasonId ?? 2027 });
    }
    if (!url.searchParams.getAll("view").includes("mMatchupScore")) {
      return Response.json(options.league ?? rawLeague());
    }
    const day = url.searchParams.get("scoringPeriodId");
    return Response.json(day === null ? rawWeek() : rawDay(Number(day)));
  });
}

function capture() {
  return captureRecordings({ season: 2027, leagueId, credentials, now: () => capturedAt });
}

async function captureFailure(): Promise<EspnError> {
  try {
    await capture();
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the capture to fail");
}

beforeEach(() => {
  espnFetch.mockReset();
  vi.stubGlobal("fetch", espnFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureRecordings", () => {
  it("writes the six recording files, holding only what the reads use, scrubbed", async () => {
    serve();

    const { files } = await capture();

    expect(Object.keys(files).sort()).toEqual([...RECORDING_FILES].sort());
    const parsed = Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, JSON.parse(text)])
    );
    expect(parsed["league.json"]).toEqual({
      "league:mRoster,mSettings,mStatus,mTeam": {
        seasonId: 2027,
        scoringPeriodId: 5,
        status: { currentMatchupPeriod: 1 },
        settings: { rosterSettings: { lineupSlotCounts } },
        teams: [7, 3].map((teamId, index) => ({
          id: teamId,
          name: `Team ${teamId}`,
          roster: {
            entries: [
              {
                playerId: 3001 + index,
                lineupSlotId: 4,
                playerPoolEntry: {
                  lineupLocked: true,
                  player: {
                    fullName: index === 0 ? "Avery Example" : "Blake Example",
                    proTeamId: 9,
                    eligibleSlots: [4, 11, 12, 13],
                    injuryStatus: index === 0 ? "OUT" : "ACTIVE",
                  },
                },
              },
            ],
          },
        })),
      },
    });
    for (const role of ["days.json", "pro-schedule.json", "game.json"]) {
      expect(parsed[role]).toEqual({});
    }
    // The week request, and the two days the read asked about to find the week's end.
    expect(Object.keys(parsed["matchups.json"]).sort()).toEqual([
      "league:mMatchup,mMatchupScore",
      "league:mMatchupScore@6",
      "league:mMatchupScore@7",
    ]);
    expect(parsed["manifest.json"]).toMatchObject({
      capturedAt: "2026-10-25T03:00:00.000Z",
      season: 2027,
      scoringPeriodId: 5,
      matchupPeriodId: 1,
      requests: [
        "league:mMatchup,mMatchupScore",
        "league:mMatchupScore@6",
        "league:mMatchupScore@7",
        "league:mRoster,mSettings,mStatus,mTeam",
      ],
      coverage: { matchupCount: 1, weekDayCount: 6, completeDayCount: 4 },
    });
  });

  it("records a league that reads back as the live read did, apart from the placeholders", async () => {
    serve();

    const { files } = await capture();
    const parsed = Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, JSON.parse(text)])
    );
    const client = createReadClient(createRecordedSource(async () => recordingsFromFiles(parsed)));
    const recorded = await client.getLineups();
    const { week } = await client.getCurrentWeek();

    expect(week).toMatchObject({
      matchupPeriodId: 1,
      scoringPeriodIds: [1, 2, 3, 4, 5, 6],
      completeScoringPeriodIds: [1, 2, 3, 4],
      todayScoringPeriodId: 5,
    });
    expect(week.matchups.map((matchup) => matchup.matchupId)).toEqual([1]);
    expect(recorded.meta).toMatchObject({
      source: "recorded",
      capturedAt: "2026-10-25T03:00:00.000Z",
      season: 2027,
      scoringPeriodId: 5,
    });
    expect(recorded.teams.map((team) => [team.teamId, team.teamName])).toEqual([
      [7, "Team 7"],
      [3, "Team 3"],
    ]);
    expect(recorded.teams[0]?.starters[0]?.player).toMatchObject({
      playerId: 3001,
      name: "Avery Example",
      designation: { status: "OUT" },
      lineupLocked: true,
    });
  });

  it("refuses to write a recording that still holds an identifying value, saying where but not what", async () => {
    serve({ league: rawLeague("Kit Marlowe") });

    const error = await captureFailure();

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/league\.json/);
    expect(error.message).toMatch(/member full name/);
    expect(error.message).not.toMatch(/Kit|Marlowe/);
  });

  it("refuses to capture a season that isn't the one in progress", async () => {
    serve({ currentSeasonId: 2028 });

    const error = await captureFailure();

    expect(error.code).toBe("season_not_in_progress");
  });
});
