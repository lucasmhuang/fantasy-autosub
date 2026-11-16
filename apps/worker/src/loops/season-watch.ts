import type { Logger, ServerEnv } from "@injurysub/config";
import { type DatabaseConnection, readSeasonEnd, recordSeasonEnd } from "@injurysub/db";
import { isSeasonOver } from "@injurysub/domain";
import {
  type CurrentWeekRead,
  type EspnClient,
  EspnError,
  type LineupsRead,
  type MatchupSide,
} from "@injurysub/espn";

export type SeasonSource = Pick<EspnClient, "getCurrentWeek" | "getLineups">;

type SeasonWatch = {
  connection: DatabaseConnection;
  espn: SeasonSource;
  // The worker's own ESPN_MODE: a practice worker's reads report the recordings' mode.
  espnMode: ServerEnv["ESPN_MODE"];
  logger: Logger;
  now: Date;
};

// Once ESPN's day passes the season's final one, records when the worker saw it and the final
// matchup period's result (each side's team, name and score), so the app can go read-only
// whoever visits (PC1-2). Hourly; once recorded, it reads ESPN no more. Only live ESPN's day is
// the league's, and a practice copy's (its after-season walk, which pnpm practice:reset undoes):
// recorded and scripted days aren't, and the week-concluded scenario's would end it for good.
export async function watchSeasonEnd(watch: SeasonWatch): Promise<void> {
  if (watch.espnMode !== "live" && watch.espnMode !== "practice") return;
  if ((await readSeasonEnd(watch.connection.db)) !== null) return;
  const read = await readOrWarn(watch, () => watch.espn.getCurrentWeek());
  if (read === null) return;
  const { todayScoringPeriodId, finalScoringPeriodId } = read.week;
  // A week that names no final day can't say the season is over.
  if (finalScoringPeriodId === undefined) return;
  if (!isSeasonOver(todayScoringPeriodId, finalScoringPeriodId)) return;
  // The week read names no teams, so their names come from one lineups read, at the end only.
  const lineups = await readOrWarn(watch, () => watch.espn.getLineups());
  if (lineups === null) return;
  const final = finalResultOf(read, lineups);
  await recordSeasonEnd(watch.connection.db, { endedAt: watch.now, final });
  watch.logger.info("worker.season.ended", { matchupPeriodId: final.matchupPeriodId });
}

async function readOrWarn<T>(watch: SeasonWatch, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    watch.logger.warn("worker.season.espn_unread", { code: error.code });
    return null;
  }
}

function finalResultOf(read: CurrentWeekRead, lineups: LineupsRead) {
  const named = (side: MatchupSide) => ({
    teamId: side.teamId,
    teamName: lineups.teams.find((team) => team.teamId === side.teamId)?.teamName ?? null,
    score: side.score,
  });
  return {
    matchupPeriodId: read.week.matchupPeriodId,
    matchups: read.week.matchups.map((matchup) => ({
      home: named(matchup.home),
      away: matchup.away === null ? null : named(matchup.away),
    })),
  };
}
