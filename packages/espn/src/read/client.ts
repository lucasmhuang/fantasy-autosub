import type {
  CredentialCheck,
  CurrentWeekRead,
  EspnReadClient,
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

async function readCurrentWeek(context: ReadContext): Promise<CurrentWeekRead> {
  const signal = createReadDeadline(context.timeoutMs);
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

async function readTeamDay(
  context: ReadContext,
  teamId: number,
  scoringPeriodId: number
): Promise<TeamDayRead> {
  const readName = `team ${teamId}'s lineup on scoring period ${scoringPeriodId}`;
  const response = await context.source({
    kind: "league",
    views: DAY_VIEWS,
    scoringPeriodId,
    readName,
    signal: createReadDeadline(context.timeoutMs),
    responseSchema: dayResponseSchema,
  });
  const league = parseResponse(dayResponseSchema, response.body, readName);
  const day = teamDayOf(league, teamId, scoringPeriodId, readName);
  return { meta: metaOf(league, response, context.now()), day };
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
  };
}
