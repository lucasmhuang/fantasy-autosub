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
const scoringItems = [
  { statId: 0, points: 1, pointsOverrides: {}, leagueRanking: 0 },
  { statId: 6, points: 1.2 },
  { statId: 3, points: 1.5 },
  { statId: 2, points: 3 },
  { statId: 1, points: 3 },
  { statId: 11, points: -1 },
];
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
        // This season's actual stats, and a projection the reads don't use.
        stats: [
          {
            statSplitTypeId: 0,
            statSourceId: 0,
            scoringPeriodId: 0,
            seasonId: 2027,
            appliedAverage: 41.5,
            appliedTotal: 83,
            stats: { "0": 40 },
          },
          {
            statSplitTypeId: 0,
            statSourceId: 1,
            scoringPeriodId: 0,
            seasonId: 2027,
            appliedAverage: 38,
          },
        ],
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
      rosterSettings: {
        lineupSlotCounts,
        lineupLocktimeType: "INDIVIDUAL_FIRSTGAME_WEEKLY",
        rosterLocktimeType: "FIRSTGAME_WEEKLY",
        moveLimit: -1,
      },
      scoringSettings: { scoringType: "H2H_POINTS", scoringItems },
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

// ESPN's raw answer to the week request: the season's schedule, with week 1 in progress on today,
// day 5 unless given.
function rawWeek(today = 5) {
  return {
    gameId: 3,
    id: leagueId,
    seasonId: 2027,
    segmentId: 0,
    scoringPeriodId: today,
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

// ESPN's raw NBA schedule: NBA team 9 is at home on day 5 and away on day 9.
function rawProSchedule() {
  const game = (scoringPeriodId: number, homeProTeamId: number, awayProTeamId: number) => ({
    awayProTeamId,
    date: Date.parse(`2026-10-${19 + scoringPeriodId}T23:00:00Z`),
    homeProTeamId,
    id: 401900000 + scoringPeriodId,
    scoringPeriodId,
    startTimeTBD: false,
    statsOfficial: false,
    validForLocking: true,
  });
  return {
    display: { someFlag: true },
    settings: {
      readOnly: true,
      proTeams: [
        {
          id: 4,
          abbrev: "OPP",
          location: "Opposing",
          name: "Examples",
          byeWeek: 0,
          proGamesByScoringPeriod: { "5": [game(5, 9, 4)], "9": [game(9, 4, 9)] },
        },
        {
          id: 9,
          abbrev: "SYN",
          location: "Synthetic",
          name: "Examples",
          byeWeek: 0,
          proGamesByScoringPeriod: { "5": [game(5, 9, 4)], "9": [game(9, 4, 9)] },
        },
      ],
    },
  };
}

function serve(
  options: { currentSeasonId?: number; league?: Record<string, unknown>; today?: number } = {}
) {
  const today = options.today ?? 5;
  espnFetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/games/fba")) {
      return Response.json({ currentSeasonId: options.currentSeasonId ?? 2027 });
    }
    if (url.searchParams.getAll("view").includes("proTeamSchedules_wl")) {
      return Response.json(rawProSchedule());
    }
    const day = url.searchParams.get("scoringPeriodId");
    if (!url.searchParams.getAll("view").includes("mMatchupScore")) {
      // A league answer for one day echoes that day, as ESPN's does; any other carries today.
      const league = options.league ?? rawLeague();
      return Response.json({ ...league, scoringPeriodId: day === null ? today : Number(day) });
    }
    return Response.json(day === null ? rawWeek(today) : rawDay(Number(day)));
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
                    // Only this season's actual stats, and only the average the outlook reads.
                    stats: [
                      {
                        statSplitTypeId: 0,
                        statSourceId: 0,
                        scoringPeriodId: 0,
                        seasonId: 2027,
                        appliedAverage: 41.5,
                      },
                    ],
                  },
                },
              },
            ],
          },
        })),
      },
      // The credential check's request: the owners as placeholders, and the owner's private lists
      // kept only as empty markers, with no draft strategy.
      "league:mTeam": {
        teams: [
          {
            id: 7,
            owners: ["{00000000-0000-0000-0000-000000000007}"],
            watchList: [],
            pendingTransactions: [],
          },
          { id: 3, owners: ["{00000000-0000-0000-0000-000000000003}"] },
        ],
      },
      // The rules check's request: the settings InjurySub compares, and no league name.
      "league:mSettings": {
        seasonId: 2027,
        scoringPeriodId: 5,
        status: { currentMatchupPeriod: 1 },
        settings: {
          rosterSettings: { lineupSlotCounts, lineupLocktimeType: "INDIVIDUAL_FIRSTGAME_WEEKLY" },
          scoringSettings: {
            scoringItems: scoringItems.map(({ statId, points, pointsOverrides }) => ({
              statId,
              points,
              ...(pointsOverrides ? { pointsOverrides } : {}),
            })),
          },
        },
      },
    });
    expect(parsed["game.json"]).toEqual({});
    // The NBA schedule, for the player outlook: each team's abbreviation and games, without ids.
    const trimmedGame = (day: number, homeProTeamId: number, awayProTeamId: number) => ({
      date: Date.parse(`2026-10-${19 + day}T23:00:00Z`),
      homeProTeamId,
      awayProTeamId,
    });
    expect(parsed["pro-schedule.json"]).toEqual({
      "pro-schedule:proTeamSchedules_wl": {
        settings: {
          proTeams: [4, 9].map((id) => ({
            id,
            abbrev: id === 4 ? "OPP" : "SYN",
            proGamesByScoringPeriod: { "5": [trimmedGame(5, 9, 4)], "9": [trimmedGame(9, 4, 9)] },
          })),
        },
      },
    });
    // Each complete day, today and tomorrow, one request each.
    expect(Object.keys(parsed["days.json"]).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((day) => `league:mRoster@${day}`)
    );
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
        ...[1, 2, 3, 4, 5, 6].map((day) => `league:mRoster@${day}`),
        "league:mSettings",
        "league:mTeam",
        "pro-schedule:proTeamSchedules_wl",
      ],
      coverage: { matchupCount: 1, weekDayCount: 6, completeDayCount: 4, recordedDayCount: 6 },
    });
  });

  // On the week's last day, tomorrow is the next week's first day, which no read of this week asks
  // about.
  it("records no day past the week's end when it captures on the week's last day", async () => {
    serve({ today: 6 });

    const { files } = await capture();

    const days: Record<string, unknown> = JSON.parse(files["days.json"]);
    expect(Object.keys(days).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((day) => `league:mRoster@${day}`)
    );
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
    const ownerPlaceholder = "{00000000-0000-0000-0000-000000000007}";
    const checked = createReadClient(
      createRecordedSource(async () => recordingsFromFiles(parsed)),
      { ownerSwid: ownerPlaceholder }
    ).checkCredentials();
    await expect(checked).resolves.toEqual({ ok: true, source: "recorded" });
    // These made-up settings lack the F, F/C and UTIL slots InjurySub expects.
    const { mismatches } = await client.checkLeagueRules();
    expect(mismatches.map((mismatch) => mismatch.kind === "setting" && mismatch.setting)).toEqual([
      "F slots",
      "F/C slots",
      "UTIL slots",
    ]);
    // Day 5 is today: NBA team 9's game that day is left in the week, and it's the next game.
    const outlook = await client.getPlayerOutlook(7);
    expect(outlook.players).toEqual([
      expect.objectContaining({
        playerId: 3001,
        seasonAveragePoints: 41.5,
        gamesLeft: 1,
        nextGame: {
          scoringPeriodId: 5,
          date: "2026-10-24T23:00:00.000Z",
          opponentProTeamId: 4,
          opponent: "OPP",
          home: true,
        },
      }),
    ]);
  });

  it("refuses to capture with cookies that aren't the owner's", async () => {
    const league = rawLeague();
    const teams = league.teams.map(
      ({ watchList, pendingTransactions, draftStrategy, ...team }) => team
    );
    serve({ league: { ...league, teams } });

    const error = await captureFailure();

    expect(error.code).toBe("credentials_rejected");
  });

  // The capture awaits the same reads, so a lineup the reads can't read stops it.
  it("refuses to capture a lineup it can't read, as the reads refuse it", async () => {
    const league = rawLeague();
    const teams = league.teams.map((team) => ({
      ...team,
      roster: { entries: team.roster.entries.map((entry) => ({ ...entry, lineupSlotId: 99 })) },
    }));
    serve({ league: { ...league, teams } });

    const error = await captureFailure();

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/slot 99/);
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
