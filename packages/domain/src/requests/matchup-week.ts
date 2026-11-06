export type MatchupWeekDays = { todayScoringPeriodId: number; scoringPeriodIds: readonly number[] };

// ESPN moves to the next matchup at its day change, so its current week reads as over only once
// the season has ended and ESPN's day keeps advancing past the final week (CLAUDE.local.md,
// "After the season"). ESPN's day, never the clock's.
export function isMatchupWeekOver(week: MatchupWeekDays): boolean {
  return week.todayScoringPeriodId > Math.max(...week.scoringPeriodIds);
}
