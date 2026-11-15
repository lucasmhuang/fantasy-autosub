import type { Matchup, MatchupSide, MatchupWeek, TeamLineup } from "./contracts";
import type { ProSchedule } from "./outlook";

// When the day's last NBA game tips, as an ISO instant, or null when the day has no games. Each
// game is listed under both its teams, which doesn't change the latest.
export function lastDayLatestTipOf(schedule: ProSchedule, lastDay: number): string | null {
  const tips = schedule.settings.proTeams.flatMap(
    (team) => team.proGamesByScoringPeriod?.[String(lastDay)]?.map((game) => game.date) ?? []
  );
  return tips.length === 0 ? null : new Date(Math.max(...tips)).toISOString();
}

// The team's matchup this week; a team on a bye is its matchup's home side, with no away side.
export function matchupOf(week: MatchupWeek, teamId: number): Matchup | null {
  return (
    week.matchups.find(
      (matchup) => matchup.home.teamId === teamId || matchup.away?.teamId === teamId
    ) ?? null
  );
}

// The matchup with each side's team name, from the league's lineups.
export function withTeamNames(
  matchup: Matchup | null,
  teams: readonly TeamLineup[]
): Matchup | null {
  if (matchup === null) return null;
  const named = (side: MatchupSide): MatchupSide => ({
    ...side,
    teamName: teams.find((team) => team.teamId === side.teamId)?.teamName ?? null,
  });
  return {
    ...matchup,
    home: named(matchup.home),
    away: matchup.away === null ? null : named(matchup.away),
  };
}
