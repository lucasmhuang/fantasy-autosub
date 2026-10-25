import type { EspnReadClient, LineupsRead, ReadMeta } from "./contracts";
import { EspnError } from "./errors";
import { type LeagueResponse, LINEUP_VIEWS, lineupsOf, parseLeagueResponse } from "./league";
import { createReadDeadline, DEFAULT_READ_TIMEOUT_MS } from "./request";
import type { EspnSource, EspnSourceResponse } from "./source";
import {
  currentWeekOf,
  DAY_MEMBERSHIP_VIEWS,
  type DayMembership,
  matchupPeriodOfDay,
  WEEK_VIEWS,
} from "./week";

export type CreateReadClientOptions = { now?: () => Date; timeoutMs?: number };

function metaOf(league: LeagueResponse, response: EspnSourceResponse, readAt: Date): ReadMeta {
  return {
    source: response.capturedAt === undefined ? "live" : "recorded",
    ...(response.capturedAt === undefined ? {} : { capturedAt: response.capturedAt }),
    season: league.seasonId,
    matchupPeriodId: league.status.currentMatchupPeriod,
    scoringPeriodId: league.scoringPeriodId,
    readAt: readAt.toISOString(),
  };
}

// The reads, over any source. Each read gets one deadline for all of its requests (FM2).
export function createReadClient(
  source: EspnSource,
  options: CreateReadClientOptions = {}
): EspnReadClient {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;

  async function readLineups(readName: string): Promise<LineupsRead> {
    const response = await source({
      kind: "league",
      views: LINEUP_VIEWS,
      readName,
      signal: createReadDeadline(timeoutMs),
    });
    const league = parseLeagueResponse(response.body, readName);
    return { meta: metaOf(league, response, now()), teams: lineupsOf(league, readName) };
  }

  return {
    getLineups() {
      return readLineups("every team's lineup");
    },
    async getLineup(teamId) {
      const { meta, teams } = await readLineups(`team ${teamId}'s lineup`);
      const team = teams.find((candidate) => candidate.teamId === teamId);
      if (!team) throw new EspnError("team_not_found", `team ${teamId} isn't in this league`);
      return { meta, team };
    },
    async getCurrentWeek() {
      const signal = createReadDeadline(timeoutMs);
      const readName = "the current matchup week";
      const response = await source({ kind: "league", views: WEEK_VIEWS, readName, signal });
      const league = parseLeagueResponse(response.body, readName);
      const asked = new Map<number, Promise<number | null>>();
      const membership: DayMembership = (day) => {
        const known = asked.get(day);
        if (known) return known;
        const dayReadName = `the matchup week of scoring period ${day}`;
        const pending = source({
          kind: "league",
          views: DAY_MEMBERSHIP_VIEWS,
          scoringPeriodId: day,
          readName: dayReadName,
          signal,
        }).then((answer) => matchupPeriodOfDay(parseLeagueResponse(answer.body, dayReadName), day));
        asked.set(day, pending);
        return pending;
      };
      const week = await currentWeekOf(league, membership, readName);
      return { meta: metaOf(league, response, now()), week };
    },
  };
}
