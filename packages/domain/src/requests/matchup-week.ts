export type MatchupWeekDays = { todayScoringPeriodId: number; scoringPeriodIds: readonly number[] };

// ESPN moves to the next matchup at its day change, so its current week reads as over only once
// the season has ended and ESPN's day keeps advancing past the final week (CLAUDE.local.md,
// "After the season"). ESPN's day, never the clock's.
export function isMatchupWeekOver(week: MatchupWeekDays): boolean {
  return week.todayScoringPeriodId > Math.max(...week.scoringPeriodIds);
}

// The league's regular season is 18 matchup periods, then a six-team playoff, one matchup a round
// (ESPN's scheduleSettings for the 2027 season: matchupPeriodCount 18, playoffTeamCount 6, read
// 2026-10-23; the step-2 cycle's evidence/espn-2027-raw/mSettings.json).
const REGULAR_SEASON_MATCHUP_PERIODS = 18;

export function isPlayoffPeriod(matchupPeriodId: number): boolean {
  return matchupPeriodId > REGULAR_SEASON_MATCHUP_PERIODS;
}
