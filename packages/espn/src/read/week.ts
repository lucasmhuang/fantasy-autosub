import { z } from "zod";
import type { Matchup, MatchupSide, MatchupWeek } from "./contracts";
import { EspnError } from "./errors";
import { leagueBaseShape, slotNameOf } from "./league";

// One request returns the current week's matchups, with each side's adjustment (mMatchupScore)
// and each starter's week-to-date points (mMatchup).
export const WEEK_VIEWS = ["mMatchup", "mMatchupScore"] as const;
// Asked with a scoring period, this view says which matchup period that day belongs to.
export const DAY_MEMBERSHIP_VIEWS = ["mMatchupScore"] as const;
// No matchup week is longer than this, so a boundary search never asks about more days.
const MAX_SCAN_DAYS = 21;

const matchupStarterSchema = z.object({
  playerId: z.number().int(),
  lineupSlotId: z.number().int(),
  playerPoolEntry: z.object({ appliedStatTotal: z.number() }),
});

const matchupSideSchema = z.object({
  teamId: z.number().int(),
  totalPoints: z.number(),
  adjustment: z.number().optional(),
  pointsByScoringPeriod: z.record(z.string(), z.number()).optional(),
  rosterForMatchupPeriod: z.object({ entries: z.array(matchupStarterSchema) }).optional(),
});

const scheduleEntrySchema = z.object({
  id: z.number().int(),
  matchupPeriodId: z.number().int(),
  home: matchupSideSchema,
  away: matchupSideSchema.optional(),
});

export const weekResponseSchema = z.object({
  ...leagueBaseShape,
  schedule: z.array(scheduleEntrySchema),
});

// In an answer for one day, only which matchups carry rosterForCurrentScoringPeriod matters: they
// are that day's week. The marker is kept as an empty object.
const daySideSchema = z.object({ rosterForCurrentScoringPeriod: z.object({}).optional() });

export const dayMembershipResponseSchema = z.object({
  ...leagueBaseShape,
  schedule: z.array(
    z.object({
      matchupPeriodId: z.number().int(),
      home: daySideSchema,
      away: daySideSchema.optional(),
    })
  ),
});

export type WeekResponse = z.infer<typeof weekResponseSchema>;
type DayMembershipResponse = z.infer<typeof dayMembershipResponseSchema>;
type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

// The matchup period a scoring period belongs to.
export type DayMembership = (scoringPeriodId: number) => Promise<number | null>;

type Bounds = { today: number; period: number; first: number; final: number };

function unrecognized(message: string): EspnError {
  return new EspnError("unrecognized_response", message);
}

function range(first: number, last: number): number[] {
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

// In an answer for one day, the matchups of that day's week carry rosterForCurrentScoringPeriod.
export function matchupPeriodOfDay(league: DayMembershipResponse, day: number): number | null {
  const periods = new Set(
    league.schedule
      .filter(
        (entry) =>
          entry.home.rosterForCurrentScoringPeriod ?? entry.away?.rosterForCurrentScoringPeriod
      )
      .map((entry) => entry.matchupPeriodId)
  );
  if (periods.size > 1) {
    throw unrecognized(`ESPN placed scoring period ${day} in ${periods.size} matchup periods`);
  }
  return [...periods][0] ?? null;
}

function sideOf(side: ScheduleEntry["home"], matchupId: number): MatchupSide {
  if (side.adjustment === undefined || side.rosterForMatchupPeriod === undefined) {
    throw unrecognized(
      `matchup ${matchupId} has no adjustment or starters for team ${side.teamId}`
    );
  }
  return {
    teamId: side.teamId,
    score: side.totalPoints,
    adjustment: side.adjustment,
    starters: side.rosterForMatchupPeriod.entries.map((entry) => ({
      playerId: entry.playerId,
      slot: slotNameOf(entry.lineupSlotId, `matchup ${matchupId}, player ${entry.playerId}`),
      weekToDatePoints: entry.playerPoolEntry.appliedStatTotal,
    })),
  };
}

function matchupOf(entry: ScheduleEntry): Matchup {
  return {
    matchupId: entry.id,
    home: sideOf(entry.home, entry.id),
    away: entry.away ? sideOf(entry.away, entry.id) : null,
  };
}

// Steps from a day while the neighbouring day still belongs to the week, never past the season.
async function extend(from: number, step: 1 | -1, bounds: Bounds, membership: DayMembership) {
  let day = from;
  for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned += 1) {
    const next = day + step;
    if (next < bounds.first || next > bounds.final) return day;
    if ((await membership(next)) !== bounds.period) return day;
    day = next;
  }
  throw unrecognized(`matchup period ${bounds.period} runs past ${MAX_SCAN_DAYS} days`);
}

// The week starts at its first day with points (or today), confirmed by the day before belonging
// to another week. Its end is guessed six days later and confirmed by that day belonging to the
// week and the next one not; when the guess falls outside the week (the six-day opening week), the
// end is found day by day from today. No day outside the season is asked about.
async function boundariesOf(firstPointDay: number, bounds: Bounds, membership: DayMembership) {
  const candidate = Math.max(bounds.first, Math.min(firstPointDay, bounds.today));
  const start = await extend(candidate, -1, bounds, membership);
  const guess = Math.min(start + 6, bounds.final);
  const guessHolds = guess >= bounds.today && (await membership(guess)) === bounds.period;
  const end = await extend(guessHolds ? guess : bounds.today, 1, bounds, membership);
  return { start, end };
}

export async function currentWeekOf(
  league: WeekResponse,
  membership: DayMembership,
  readName: string
): Promise<MatchupWeek> {
  const {
    currentMatchupPeriod: period,
    firstScoringPeriod: first,
    finalScoringPeriod: final,
  } = league.status;
  if (first === undefined || final === undefined) {
    throw unrecognized(`ESPN's week response has no season bounds (reading ${readName})`);
  }
  const current = league.schedule.filter((entry) => entry.matchupPeriodId === period);
  if (current.length === 0) {
    throw unrecognized(`ESPN lists no matchups for matchup period ${period} (reading ${readName})`);
  }
  const today = league.scoringPeriodId;
  const pointDays = current
    .flatMap((entry) => [entry.home, entry.away])
    .flatMap((side) => Object.keys(side?.pointsByScoringPeriod ?? {}).map(Number));
  const firstPointDay = pointDays.length > 0 ? Math.min(...pointDays) : today;
  const { start, end } = await boundariesOf(
    firstPointDay,
    { today, period, first, final },
    membership
  );
  return {
    matchupPeriodId: period,
    scoringPeriodIds: range(start, end),
    completeScoringPeriodIds: range(start, today - 1),
    todayScoringPeriodId: today,
    matchups: current.map(matchupOf),
  };
}
