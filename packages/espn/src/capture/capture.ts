import { z } from "zod";
import { createReadClient } from "../read/client";
import type { LineupsRead, MatchupWeek } from "../read/contracts";
import { EspnError } from "../read/errors";
import { LINEUP_VIEWS } from "../read/league";
import type { EspnCredentials } from "../read/request";
import {
  createLiveSource,
  createRecordingSource,
  type RecordedRequest,
  requestKey,
} from "../read/source";
import {
  checkRecordingShape,
  findIdentifyingValues,
  type RecordingIdentities,
  scrubRecording,
} from "./scrub";

// Records the real reads against live ESPN, read-only, and turns what they requested into the
// committed recordings: trimmed by each request's own schema, scrubbed, then checked. Nothing is
// written unless both checks pass. Writing the files is the caller's job.

export const RECORDING_FILES = [
  "league.json",
  "days.json",
  "matchups.json",
  "pro-schedule.json",
  "game.json",
  "manifest.json",
] as const;

export type RecordingFileName = (typeof RECORDING_FILES)[number];

type RoleFile = Exclude<RecordingFileName, "manifest.json">;

const ROLE_FILES: readonly RoleFile[] = [
  "league.json",
  "days.json",
  "matchups.json",
  "pro-schedule.json",
  "game.json",
];

export type CaptureOptions = {
  season: number;
  leagueId: number;
  credentials: EspnCredentials;
  now?: () => Date;
};

export type CaptureSummary = Record<string, number>;

export type CaptureResult = {
  files: Record<RecordingFileName, string>;
  summary: CaptureSummary;
};

// The identifying fields of the raw lineup response, read before anything is trimmed.
const identitySchema = z.object({
  settings: z.object({ name: z.string() }),
  members: z.array(
    z.object({
      id: z.string(),
      firstName: z.string().default(""),
      lastName: z.string().default(""),
      displayName: z.string().default(""),
    })
  ),
  teams: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().default(""),
      abbrev: z.string().default(""),
      owners: z.array(z.string()).default([]),
      primaryOwner: z.string().optional(),
    })
  ),
});

const MAX_LISTED_PROBLEMS = 20;

function unrecognized(message: string, cause?: Error): EspnError {
  return new EspnError("unrecognized_response", message, cause ? { cause } : {});
}

function identitiesOf(
  recorded: ReadonlyMap<string, RecordedRequest>,
  options: CaptureOptions
): RecordingIdentities {
  const raw = recorded.get(requestKey({ kind: "league", views: LINEUP_VIEWS }))?.body;
  const parsed = identitySchema.safeParse(raw);
  if (!parsed.success) {
    throw unrecognized(
      "the lineup response has no readable members, teams or league name",
      parsed.error
    );
  }
  return {
    leagueId: options.leagueId,
    leagueName: parsed.data.settings.name,
    espnS2: options.credentials.espnS2,
    members: parsed.data.members,
    teams: parsed.data.teams,
  };
}

function roleOf(request: RecordedRequest): RoleFile {
  if (request.kind === "game") return "game.json";
  if (request.kind === "pro-schedule") return "pro-schedule.json";
  if (request.views.some((view) => view === "mMatchupScore" || view === "mMatchup")) {
    return "matchups.json";
  }
  return request.scoringPeriodId === undefined ? "league.json" : "days.json";
}

// The schema a request's read parses with, so the recording keeps exactly what the read uses.
function trimmed(key: string, request: RecordedRequest): unknown {
  if (request.responseSchema === undefined) {
    throw unrecognized(`the capture has no schema to trim ${key}`);
  }
  const parsed = request.responseSchema.safeParse(request.body);
  if (!parsed.success) throw unrecognized(`ESPN's answer to ${key} isn't readable`, parsed.error);
  return parsed.data;
}

function roleFilesOf(
  recorded: ReadonlyMap<string, RecordedRequest>,
  identities: RecordingIdentities
): Record<RoleFile, Record<string, unknown>> {
  const files: Record<RoleFile, Record<string, unknown>> = {
    "league.json": {},
    "days.json": {},
    "matchups.json": {},
    "pro-schedule.json": {},
    "game.json": {},
  };
  for (const [key, request] of recorded) files[roleOf(request)][key] = trimmed(key, request);
  for (const role of ROLE_FILES) files[role] = scrubRecording(files[role], identities);
  return files;
}

function coverageOf(lineups: LineupsRead): CaptureSummary {
  const starters = lineups.teams.flatMap((team) => team.starters);
  const all = lineups.teams.flatMap((team) => [
    ...team.starters,
    ...team.bench,
    ...team.injuredReserve,
  ]);
  const players = all.flatMap((slot) => (slot.player ? [slot.player] : []));
  const designated = (status: string) =>
    players.filter((player) => player.designation.status === status).length;
  return {
    teamCount: lineups.teams.length,
    playerCount: players.length,
    emptySlotCount: all.length - players.length,
    outStarterCount: starters.filter((slot) => slot.player?.designation.status === "OUT").length,
    outCount: designated("OUT"),
    suspendedCount: designated("SUSPENSION"),
    unrecognizedDesignationCount: designated("unrecognized"),
    injuredReserveCount: lineups.teams
      .flatMap((team) => team.injuredReserve)
      .filter((slot) => slot.player).length,
    lineupLockedCount: players.filter((player) => player.lineupLocked).length,
  };
}

// Each complete day, today, and tomorrow while it's still in the week.
function daysToRecord(week: MatchupWeek): number[] {
  const tomorrow = week.todayScoringPeriodId + 1;
  return [
    ...week.completeScoringPeriodIds,
    week.todayScoringPeriodId,
    ...(week.scoringPeriodIds.includes(tomorrow) ? [tomorrow] : []),
  ];
}

function textOf(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Both checks run on the exact text to be written, every file included. They list where a problem
// is, never the value.
function verified(
  files: Record<RecordingFileName, string>,
  identities: RecordingIdentities
): Record<RecordingFileName, string> {
  const parsed = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, JSON.parse(text)])
  );
  const found = findIdentifyingValues(parsed, identities).map(
    ({ file, path, kind }) => `${file} ${path} (${kind})`
  );
  const shape = checkRecordingShape(parsed).map(
    ({ file, path, problem }) => `${file} ${path}: ${problem}`
  );
  const listed = [...found, ...shape];
  if (listed.length === 0) return files;
  const more =
    listed.length > MAX_LISTED_PROBLEMS ? `; and ${listed.length - MAX_LISTED_PROBLEMS} more` : "";
  throw unrecognized(
    `the capture refused to write recordings holding ${found.length} identifying values and ` +
      `${shape.length} other problems: ${listed.slice(0, MAX_LISTED_PROBLEMS).join("; ")}${more}`
  );
}

// Runs the real reads against live ESPN through a recording source. One day request answers for
// every team, so asking for one team records the whole league's day. The capture needs the owner's
// cookies, so a failed credential check stops it.
async function recordTheReads(options: CaptureOptions, now: () => Date) {
  const recording = createRecordingSource(
    createLiveSource({
      season: options.season,
      leagueId: options.leagueId,
      credentials: options.credentials,
    })
  );
  const reads = createReadClient(recording.source, { now, ownerSwid: options.credentials.swid });
  const lineups = await reads.getLineups();
  await reads.checkCredentials();
  await reads.checkLeagueRules();
  const { week } = await reads.getCurrentWeek();
  const recordedDays = daysToRecord(week);
  const [anyTeam] = lineups.teams;
  if (!anyTeam) throw unrecognized("the lineup read found no teams to record days for");
  for (const day of recordedDays) await reads.getTeamDay(anyTeam.teamId, day);
  // Its requests answer for every team: the lineup, the week, the NBA schedule and the days.
  await reads.getPlayerOutlook(anyTeam.teamId);
  return { lineups, week, recordedDays, recorded: recording.recorded() };
}

export async function captureRecordings(options: CaptureOptions): Promise<CaptureResult> {
  const now = options.now ?? (() => new Date());
  const { lineups, week, recordedDays, recorded } = await recordTheReads(options, now);
  const identities = identitiesOf(recorded, options);
  const coverage = {
    ...coverageOf(lineups),
    matchupCount: week.matchups.length,
    weekDayCount: week.scoringPeriodIds.length,
    completeDayCount: week.completeScoringPeriodIds.length,
    recordedDayCount: recordedDays.length,
  };
  const manifest = {
    capturedAt: now().toISOString(),
    season: lineups.meta.season,
    matchupPeriodId: lineups.meta.matchupPeriodId,
    scoringPeriodId: lineups.meta.scoringPeriodId,
    requests: [...recorded.keys()].sort(),
    coverage,
  };
  const roles = roleFilesOf(recorded, identities);
  const files: Record<RecordingFileName, string> = {
    "league.json": textOf(roles["league.json"]),
    "days.json": textOf(roles["days.json"]),
    "matchups.json": textOf(roles["matchups.json"]),
    "pro-schedule.json": textOf(roles["pro-schedule.json"]),
    "game.json": textOf(roles["game.json"]),
    "manifest.json": textOf(manifest),
  };
  return { files: verified(files, identities), summary: coverage };
}
