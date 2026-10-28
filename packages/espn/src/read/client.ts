import type {
  CredentialCheck,
  CurrentWeekRead,
  EspnReadClient,
  LeagueRulesRead,
  LineupsRead,
  PlayerOutlookRead,
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
import {
  PRO_SCHEDULE_VIEWS,
  type ProSchedule,
  playerOutlooksOf,
  proScheduleResponseSchema,
  seasonAveragesOf,
} from "./outlook";
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

// The lineup request: every team's roster, the slot counts and the status.
async function requestLineups(context: ReadContext, readName: string, signal: AbortSignal) {
  const response = await context.source({
    kind: "league",
    views: LINEUP_VIEWS,
    readName,
    signal,
    responseSchema: lineupResponseSchema,
  });
  return { response, league: parseResponse(lineupResponseSchema, response.body, readName) };
}

async function readLineups(context: ReadContext, readName: string): Promise<LineupsRead> {
  const signal = createReadDeadline(context.timeoutMs);
  const { response, league } = await requestLineups(context, readName, signal);
  return { meta: metaOf(league, response, context.now()), teams: lineupsOf(league, readName) };
}

// Asks which matchup period a day belongs to, at most once per day within one read.
function dayMembershipFor(context: ReadContext, signal: AbortSignal): DayMembership {
  const asked = new Map<number, Promise<number>>();
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
      .then((answer) => {
        const league = parseResponse(dayMembershipResponseSchema, answer.body, readName);
        // ESPN echoes the day it was asked about; an answer for another day would misplace this one.
        if (league.scoringPeriodId !== day) {
          throw new EspnError(
            "unrecognized_response",
            `ESPN answered scoring period ${league.scoringPeriodId} when asked for ${day} (reading ${readName})`
          );
        }
        return matchupPeriodOfDay(league, day);
      });
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

// One day's lineups and lines for every team: one request answers for the whole league. ESPN
// echoes the day it was asked for; an answer for another day would read as nobody having played.
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
  const league = parseResponse(dayResponseSchema, response.body, readName);
  if (league.scoringPeriodId !== scoringPeriodId) {
    throw new EspnError(
      "unrecognized_response",
      `ESPN answered scoring period ${league.scoringPeriodId} when asked for ${scoringPeriodId} (reading ${readName})`
    );
  }
  return { response, league };
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

// The settings against the league InjurySub expects, then every line of the current week's
// complete days against the league formula, all under one deadline.
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

async function readProSchedule(
  context: ReadContext,
  readName: string,
  signal: AbortSignal
): Promise<ProSchedule> {
  const response = await context.source({
    kind: "pro-schedule",
    views: PRO_SCHEDULE_VIEWS,
    readName,
    signal,
    responseSchema: proScheduleResponseSchema,
  });
  return parseResponse(proScheduleResponseSchema, response.body, readName);
}

// A team's roster with each player's week so far and what's left of it, all under one deadline:
// the lineup, the week, the NBA schedule, then the team's complete days.
async function readPlayerOutlook(context: ReadContext, teamId: number): Promise<PlayerOutlookRead> {
  const signal = createReadDeadline(context.timeoutMs);
  const readName = `team ${teamId}'s player outlook`;
  const [lineups, { week }, schedule] = await Promise.all([
    requestLineups(context, readName, signal),
    readCurrentWeek(context, signal),
    readProSchedule(context, readName, signal),
  ]);
  const lineup = lineupsOf(lineups.league, readName).find((team) => team.teamId === teamId);
  if (!lineup) throw new EspnError("team_not_found", `team ${teamId} isn't in this league`);
  const completeDays = await Promise.all(
    week.completeScoringPeriodIds.map(async (day) => {
      const { league } = await readDay(context, day, readName, signal);
      return teamDayOf(league, teamId, day, readName);
    })
  );
  const seasonAverages = seasonAveragesOf(lineups.league, teamId);
  return {
    meta: metaOf(lineups.league, lineups.response, context.now()),
    teamId,
    players: playerOutlooksOf({ lineup, seasonAverages, completeDays, week, schedule, readName }),
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

// The reads, over any source. Each read gets one deadline for all of its requests.
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
    getPlayerOutlook: (teamId) => readPlayerOutlook(context, teamId),
  };
}
