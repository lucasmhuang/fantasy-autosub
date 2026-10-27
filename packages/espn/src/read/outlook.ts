import { z } from "zod";
import type {
  DayLine,
  MatchupWeek,
  PlayerOutlook,
  ProGame,
  TeamDay,
  TeamLineup,
} from "./contracts";
import type { LineupResponse, SeasonStat } from "./league";

// The NBA schedule, every pro team's games by scoring period: a season-level request, with no
// league in it.
export const PRO_SCHEDULE_VIEWS = ["proTeamSchedules_wl"] as const;

// Each team's id and abbreviation, and each game's start and teams. Game ids aren't read.
export const proScheduleResponseSchema = z.object({
  settings: z.object({
    proTeams: z.array(
      z.object({
        id: z.number().int(),
        abbrev: z.string(),
        proGamesByScoringPeriod: z
          .record(
            z.string(),
            z.array(
              z.object({
                date: z.number(),
                homeProTeamId: z.number().int(),
                awayProTeamId: z.number().int(),
              })
            )
          )
          .optional(),
      })
    ),
  }),
});

export type ProSchedule = z.infer<typeof proScheduleResponseSchema>;

// ESPN's season average for the given season, or null when ESPN has no entry for that season.
export function seasonAverageOf(
  stats: readonly SeasonStat[] | undefined,
  season: number
): number | null {
  return stats?.find((stat) => stat.seasonId === season)?.appliedAverage ?? null;
}

// The season average of each player on the team's roster, for the league's season.
export function seasonAveragesOf(
  league: LineupResponse,
  teamId: number
): Map<number, number | null> {
  const team = league.teams?.find((candidate) => candidate.id === teamId);
  return new Map(
    (team?.roster?.entries ?? []).map((entry) => [
      entry.playerId,
      seasonAverageOf(entry.playerPoolEntry.player.stats, league.seasonId),
    ])
  );
}

const NO_LINE: DayLine = {
  fantasyPoints: 0,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
};

function addLines(sum: DayLine, line: DayLine): DayLine {
  return {
    fantasyPoints: sum.fantasyPoints + line.fantasyPoints,
    points: sum.points + line.points,
    rebounds: sum.rebounds + line.rebounds,
    assists: sum.assists + line.assists,
    steals: sum.steals + line.steals,
    blocks: sum.blocks + line.blocks,
    turnovers: sum.turnovers + line.turnovers,
  };
}

// One NBA team's games, earliest first.
function gamesOf(schedule: ProSchedule, proTeamId: number): ProGame[] {
  const { proTeams } = schedule.settings;
  const abbreviations = new Map(proTeams.map((team) => [team.id, team.abbrev]));
  const team = proTeams.find((candidate) => candidate.id === proTeamId);
  return Object.entries(team?.proGamesByScoringPeriod ?? {})
    .flatMap(([day, games]) =>
      games.map((game) => {
        const home = game.homeProTeamId === proTeamId;
        const opponentProTeamId = home ? game.awayProTeamId : game.homeProTeamId;
        return {
          scoringPeriodId: Number(day),
          date: new Date(game.date).toISOString(),
          opponentProTeamId,
          opponent: abbreviations.get(opponentProTeamId) ?? `team ${opponentProTeamId}`,
          home,
        };
      })
    )
    .sort((a, b) => a.scoringPeriodId - b.scoringPeriodId || a.date.localeCompare(b.date));
}

type OutlookInput = {
  lineup: TeamLineup;
  seasonAverages: ReadonlyMap<number, number | null>;
  completeDays: readonly TeamDay[];
  week: MatchupWeek;
  schedule: ProSchedule;
};

// Every rostered player's outlook, in lineup order: starters, then the bench, then IR.
export function playerOutlooksOf(input: OutlookInput): PlayerOutlook[] {
  const { lineup, seasonAverages, completeDays, week, schedule } = input;
  const today = week.todayScoringPeriodId;
  const lastDay = Math.max(...week.scoringPeriodIds);
  return [...lineup.starters, ...lineup.bench, ...lineup.injuredReserve].flatMap((slot) => {
    const { player } = slot;
    if (!player) return [];
    const lines = completeDays.flatMap((day) =>
      day.players.flatMap((each) =>
        each.playerId === player.playerId && each.line
          ? [{ active: each.active, line: each.line }]
          : []
      )
    );
    const games = gamesOf(schedule, player.proTeamId).filter(
      (game) => game.scoringPeriodId >= today
    );
    return [
      {
        playerId: player.playerId,
        name: player.name,
        proTeamId: player.proTeamId,
        seasonAveragePoints: seasonAverages.get(player.playerId) ?? null,
        weekToDate: lines.reduce((sum, day) => addLines(sum, day.line), NO_LINE),
        creditedPoints: lines.reduce(
          (sum, day) => sum + (day.active ? day.line.fantasyPoints : 0),
          0
        ),
        gamesLeft: games.filter((game) => game.scoringPeriodId <= lastDay).length,
        nextGame: games[0] ?? null,
      },
    ];
  });
}
