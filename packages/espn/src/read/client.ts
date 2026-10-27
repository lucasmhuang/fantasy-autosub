import type {
  CredentialCheck,
  CurrentWeekRead,
  EspnReadClient,
  LeagueRulesRead,
  LineupsRead,
  ReadMeta,
  TeamDayRead,
} from "./contracts";
import { CREDENTIAL_VIEWS, confirmOwnerCredentials, credentialResponseSchema } from "./credentials";
import { DAY_VIEWS, dayResponseSchema, teamDayOf } from "./day";
import { EspnError } from "./errors";
import {
  type LeagueBase,
  LINEUP_VIEWS,
  lineupResponseSchema,
  lineupsOf,
  parseResponse,
} from "./league";
import { createReadDeadline, DEFAULT_READ_TIMEOUT_MS } from "./request";
import {
  dayPointMismatchesOf,
  RULES_VIEWS,
  rulesResponseSchema,
  settingMismatchesOf,
} from "./rules";
import type { EspnSource, EspnSourceResponse } from "./source";
import {
  currentWeekOf,
  DAY_MEMBERSHIP_VIEWS,
  type DayMembership,
  dayMembershipResponseSchema,
  matchupPeriodOfDay,
  WEEK_VIEWS,
  weekResponseSchema,
} from "./week";

// ownerSwid is the member whose cookies the reads use (ESPN_SWID); only the credential check needs it.
export type CreateReadClientOptions = { now?: () => Date; timeoutMs?: number; ownerSwid?: string };

type ReadContext = { source: EspnSource; now: () => Date; timeoutMs: number };

function metaOf(league: LeagueBase, response: EspnSourceResponse, readAt: Date): ReadMeta {
  return {
    source: response.capturedAt === undefined ? "live" : "recorded",
    ...(response.capturedAt === undefined ? {} : { capturedAt: response.capturedAt }),
    season: league.seasonId,
    matchupPeriodId: league.status.currentMatchupPeriod,
    scoringPeriodId: league.scoringPeriodId,
    readAt: readAt.toISOString(),
  };
}

async function readLineups(context: ReadContext, readName: string): Promise<LineupsRead> {
  const response = await context.source({
    kind: "league",
    views: LINEUP_VIEWS,
    readName,
    signal: createReadDeadline(context.timeoutMs),
    responseSchema: lineupResponseSchema,
  });
  const league = parseResponse(lineupResponseSchema, response.body, readName);
  return { meta: metaOf(league, response, context.now()), teams: lineupsOf(league, readName) };
}

// Asks which matchup period a day belongs to, at most once per day within one read.
function dayMembershipFor(context: ReadContext, signal: AbortSignal): DayMembership {
  const asked = new Map<number, Promise<number | null>>();
  return (day) => {
    const known = asked.get(day);
    if (known) return known;
    const readName = `the matchup week of scoring period ${day}`;
    const pending = context
      .source({
        kind: "league",
        views: DAY_MEMBERSHIP_VIEWS,
        scoringPeriodId: day,
        readName,
        signal,
        responseSchema: dayMembershipResponseSchema,
      })
      .then((answer) =>
        matchupPeriodOfDay(parseResponse(dayMembershipResponseSchema, answer.body, readName), day)
      );
    asked.set(day, pending);
    return pending;
  };
}

// The week read under its own deadline, or under a larger read's.
async function readCurrentWeek(
  context: ReadContext,
  signal = createReadDeadline(context.timeoutMs)
): Promise<CurrentWeekRead> {
  const readName = "the current matchup week";
  const response = await context.source({
    kind: "league",
    views: WEEK_VIEWS,
    readName,
    signal,
    responseSchema: weekResponseSchema,
  });
  const league = parseResponse(weekResponseSchema, response.body, readName);
  const week = await currentWeekOf(league, dayMembershipFor(context, signal), readName);
  return { meta: metaOf(league, response, context.now()), week };
}

// One day's lineups and lines for every team: one request answers for the whole league.
async function readDay(
  context: ReadContext,
  scoringPeriodId: number,
  readName: string,
  signal: AbortSignal
) {
  const response = await context.source({
    kind: "league",
    views: DAY_VIEWS,
    scoringPeriodId,
    readName,
    signal,
    responseSchema: dayResponseSchema,
  });
  return { response, league: parseResponse(dayResponseSchema, response.body, readName) };
}

async function readTeamDay(
  context: ReadContext,
  teamId: number,
  scoringPeriodId: number
): Promise<TeamDayRead> {
  const readName = `team ${teamId}'s lineup on scoring period ${scoringPeriodId}`;
  const signal = createReadDeadline(context.timeoutMs);
  const { response, league } = await readDay(context, scoringPeriodId, readName, signal);
  const day = teamDayOf(league, teamId, scoringPeriodId, readName);
  return { meta: metaOf(league, response, context.now()), day };
}

// The settings against the PRD's, then every line of the current week's complete days against the
// league formula, all under one deadline.
async function readLeagueRules(context: ReadContext): Promise<LeagueRulesRead> {
  const signal = createReadDeadline(context.timeoutMs);
  const readName = "the league rules";
  const response = await context.source({
    kind: "league",
    views: RULES_VIEWS,
    readName,
    signal,
    responseSchema: rulesResponseSchema,
  });
  const league = parseResponse(rulesResponseSchema, response.body, readName);
  const { week } = await readCurrentWeek(context, signal);
  const days = await Promise.all(
    week.completeScoringPeriodIds.map(async (day) => {
      const { league: dayLeague } = await readDay(context, day, readName, signal);
      return dayLeague.teams.map((team) => teamDayOf(dayLeague, team.id, day, readName));
    })
  );
  return {
    meta: metaOf(league, response, context.now()),
    mismatches: [...settingMismatchesOf(league), ...dayPointMismatchesOf(days.flat())],
  };
}

async function readCredentialCheck(
  context: ReadContext,
  ownerSwid: string | undefined
): Promise<CredentialCheck> {
  if (ownerSwid === undefined) {
    throw new EspnError(
      "credentials_rejected",
      "ESPN credentials can't be checked: no member id (ESPN_SWID) is configured"
    );
  }
  const readName = "the ESPN credential check";
  const response = await context.source({
    kind: "league",
    views: CREDENTIAL_VIEWS,
    readName,
    signal: createReadDeadline(context.timeoutMs),
    responseSchema: credentialResponseSchema,
  });
  confirmOwnerCredentials(
    parseResponse(credentialResponseSchema, response.body, readName),
    ownerSwid
  );
  return { ok: true, source: response.capturedAt === undefined ? "live" : "recorded" };
}

// The reads, over any source. Each read gets one deadline for all of its requests (FM2).
export function createReadClient(
  source: EspnSource,
  options: CreateReadClientOptions = {}
): EspnReadClient {
  const context: ReadContext = {
    source,
    now: options.now ?? (() => new Date()),
    timeoutMs: options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
  };

  return {
    getLineups: () => readLineups(context, "every team's lineup"),
    async getLineup(teamId) {
      const { meta, teams } = await readLineups(context, `team ${teamId}'s lineup`);
      const team = teams.find((candidate) => candidate.teamId === teamId);
      if (!team) throw new EspnError("team_not_found", `team ${teamId} isn't in this league`);
      return { meta, team };
    },
    getCurrentWeek: () => readCurrentWeek(context),
    getTeamDay: (teamId, scoringPeriodId) => readTeamDay(context, teamId, scoringPeriodId),
    checkCredentials: () => readCredentialCheck(context, options.ownerSwid),
    checkLeagueRules: () => readLeagueRules(context),
  };
}
