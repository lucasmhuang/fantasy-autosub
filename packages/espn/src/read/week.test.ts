import { describe, expect, it } from "vitest";
import { createEspnClient } from "../client";
import { createReadClient } from "./client";
import { EspnError } from "./errors";
import { createRecordedSource, requestKey } from "./source";
import { DAY_MEMBERSHIP_VIEWS, WEEK_VIEWS } from "./week";

// Made-up answers, shaped like ESPN's. The week request answers with the season's schedule; a day
// request (mMatchupScore with a scoring period) marks the day's matchup period by giving its
// matchups a rosterForCurrentScoringPeriod.

type WeekOptions = {
  today: number;
  period: number;
  final?: number;
  pointDays?: readonly number[];
  withAdjustments?: boolean;
};

function side(teamId: number, options: WeekOptions) {
  return {
    teamId,
    totalPoints: 100.5,
    ...(options.withAdjustments === false ? {} : { adjustment: teamId === 1 ? -4 : 0 }),
    pointsByScoringPeriod: Object.fromEntries(
      (options.pointDays ?? []).map((day) => [String(day), 10])
    ),
    rosterForMatchupPeriod: {
      entries: [
        {
          playerId: teamId * 100 + 1,
          lineupSlotId: 4,
          playerPoolEntry: { appliedStatTotal: 21.5 },
        },
      ],
    },
  };
}

function weekAnswer(options: WeekOptions) {
  return {
    seasonId: 2027,
    scoringPeriodId: options.today,
    status: {
      currentMatchupPeriod: options.period,
      firstScoringPeriod: 1,
      finalScoringPeriod: options.final ?? 153,
    },
    schedule: [
      {
        id: 40,
        matchupPeriodId: options.period - 1,
        home: side(1, options),
        away: side(2, options),
      },
      { id: 41, matchupPeriodId: options.period, home: side(1, options), away: side(2, options) },
    ],
  };
}

function dayAnswer(day: number, period: number) {
  return {
    seasonId: 2027,
    scoringPeriodId: day,
    status: { currentMatchupPeriod: 1 },
    schedule: [
      {
        id: 99,
        matchupPeriodId: period,
        home: { teamId: 1, totalPoints: 0, rosterForCurrentScoringPeriod: {} },
        away: { teamId: 2, totalPoints: 0 },
      },
    ],
  };
}

// Only the listed days are recorded, so a read that asks about any other day fails as not recorded.
function readWeek(options: WeekOptions, dayPeriods: Record<number, number>) {
  const responses = new Map<string, unknown>([
    [requestKey({ kind: "league", views: WEEK_VIEWS }), weekAnswer(options)],
    ...Object.entries(dayPeriods).map(([day, period]): [string, unknown] => [
      requestKey({ kind: "league", views: DAY_MEMBERSHIP_VIEWS, scoringPeriodId: Number(day) }),
      dayAnswer(Number(day), period),
    ]),
  ]);
  const recordings = { capturedAt: "2026-10-25T01:00:00.000Z", season: 2027, responses };
  return createReadClient(createRecordedSource(async () => recordings)).getCurrentWeek();
}

const days = (first: number, last: number) =>
  Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);

async function readFailure(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

describe("the current matchup week", () => {
  it("finds the six-day opening week, without asking about any day before the season", async () => {
    const { week } = await readWeek(
      { today: 4, period: 1, pointDays: [1, 2, 3] },
      { 5: 1, 6: 1, 7: 2 }
    );

    expect(week).toMatchObject({
      matchupPeriodId: 1,
      scoringPeriodIds: days(1, 6),
      completeScoringPeriodIds: [1, 2, 3],
      todayScoringPeriodId: 4,
    });
  });

  it("finds a Monday-to-Sunday week, keeping today out of the complete days", async () => {
    const { week } = await readWeek(
      { today: 9, period: 2, pointDays: [7, 8, 9] },
      { 6: 1, 13: 2, 14: 3 }
    );

    expect(week).toMatchObject({
      scoringPeriodIds: days(7, 13),
      completeScoringPeriodIds: [7, 8],
      todayScoringPeriodId: 9,
    });
  });

  it("has no complete days on the week's first day", async () => {
    const { week } = await readWeek({ today: 7, period: 2 }, { 6: 1, 13: 2, 14: 3 });

    expect(week).toMatchObject({
      scoringPeriodIds: days(7, 13),
      completeScoringPeriodIds: [],
      todayScoringPeriodId: 7,
    });
  });

  it("reaches back to a first day that had no points yet", async () => {
    const { week } = await readWeek(
      { today: 10, period: 2, pointDays: [8, 9] },
      { 6: 1, 7: 2, 13: 2, 14: 3 }
    );

    expect(week.scoringPeriodIds).toEqual(days(7, 13));
    expect(week.completeScoringPeriodIds).toEqual([7, 8, 9]);
  });

  it("follows a week longer than seven days, such as the All-Star break's", async () => {
    const longWeek = Object.fromEntries(days(23, 30).map((day) => [day, 3]));
    const { week } = await readWeek(
      { today: 20, period: 3, pointDays: [17, 18, 19] },
      { 16: 2, ...longWeek, 31: 4 }
    );

    expect(week.scoringPeriodIds).toEqual(days(17, 30));
    expect(week.completeScoringPeriodIds).toEqual([17, 18, 19]);
  });

  it("ends a short last week on the season's final scoring period, never asking past it", async () => {
    const { week } = await readWeek(
      { today: 153, period: 21, final: 153, pointDays: days(149, 152) },
      { 148: 20, 153: 21 }
    );

    expect(week.scoringPeriodIds).toEqual(days(149, 153));
    expect(week.completeScoringPeriodIds).toEqual(days(149, 152));
  });

  it("lists this week's matchups with their ids, scores, adjustments and starters' points", async () => {
    const read = await readWeek(
      { today: 9, period: 2, pointDays: [7, 8, 9] },
      { 6: 1, 13: 2, 14: 3 }
    );

    expect(read.meta).toMatchObject({ source: "recorded", matchupPeriodId: 2, scoringPeriodId: 9 });
    expect(read.week.matchups).toEqual([
      {
        matchupId: 41,
        home: {
          teamId: 1,
          score: 100.5,
          adjustment: -4,
          starters: [{ playerId: 101, slot: "C", weekToDatePoints: 21.5 }],
        },
        away: {
          teamId: 2,
          score: 100.5,
          adjustment: 0,
          starters: [{ playerId: 201, slot: "C", weekToDatePoints: 21.5 }],
        },
      },
    ]);
  });

  it("refuses matchups without their adjustments, rather than reading them as zero", async () => {
    const failure = await readFailure(
      readWeek(
        { today: 9, period: 2, pointDays: [7, 8, 9], withAdjustments: false },
        { 6: 1, 13: 2, 14: 3 }
      )
    );

    expect(failure.code).toBe("unrecognized_response");
    expect(failure.message).toMatch(/matchup 41/);
  });
});

// The committed recording of the real league. These hold on any capture day from Tuesday to Saturday.
describe("the recorded week", () => {
  it("is an unbroken run of days that holds today, with only the earlier days complete", async () => {
    const { meta, week } = await createEspnClient({ mode: "stub" }).getCurrentWeek();

    const [first = 0] = week.scoringPeriodIds;
    expect(meta.source).toBe("recorded");
    expect(week.scoringPeriodIds).toEqual(days(first, first + week.scoringPeriodIds.length - 1));
    expect(week.scoringPeriodIds).toContain(week.todayScoringPeriodId);
    expect(week.completeScoringPeriodIds).toEqual(
      week.scoringPeriodIds.filter((day) => day < week.todayScoringPeriodId)
    );
  });

  it("pairs every team in the league in exactly one matchup, each side with its ten starters", async () => {
    const client = createEspnClient({ mode: "stub" });
    const { week } = await client.getCurrentWeek();
    const { teams } = await client.getLineups();

    const sides = week.matchups.flatMap((matchup) =>
      matchup.away ? [matchup.home, matchup.away] : [matchup.home]
    );
    expect(sides.map((side) => side.teamId).sort((a, b) => a - b)).toEqual(
      teams.map((team) => team.teamId).sort((a, b) => a - b)
    );
    for (const side of sides) {
      expect(side.starters).toHaveLength(10);
      expect(Number.isFinite(side.score) && Number.isFinite(side.adjustment)).toBe(true);
    }
  });
});
