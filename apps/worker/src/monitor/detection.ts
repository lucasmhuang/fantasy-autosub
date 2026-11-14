import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  enqueueEmail,
  findActiveCommissioner,
  getMisuseWatch,
  listByHandCompletionsSince,
  listMatchupPeriodRequests,
  listSentEspnWritesSince,
  type MisuseWatchRecord,
  recordMisuseAlert,
  recordMisuseWatch,
} from "@injurysub/db";
import { espnAccessStateFor } from "@injurysub/domain";
import { buildMisuseAlertOutboxEmail, buildWatchPausedOutboxEmail } from "@injurysub/email";
import {
  EspnError,
  type EspnErrorCode,
  type EspnMode,
  type EspnMonitoringClient,
  type EspnReadOnlyClient,
  type LeagueTransaction,
  lineupSlotNames,
} from "@injurysub/espn";
import { type EspnAccessContext, readEspn } from "../executor/preflight";
import type { ScheduledTask } from "../loops/scheduler";
import { describeFinding, type LeagueNames } from "./alert-text";
import {
  type AppRecords,
  adjustmentFindings,
  completionsOf,
  type Finding,
  type LeagueRead,
  leagueFindings,
  lineupFindings,
  mismatchFindings,
  sentWritesOf,
} from "./findings";

export type DetectionContext = EspnAccessContext & {
  espn: Pick<EspnReadOnlyClient, "getCurrentWeek" | "getLineups">;
  monitor: EspnMonitoringClient;
};

export type DetectionResult =
  | { kind: "watched"; alertsCreated: number }
  | { kind: "paused"; code: EspnErrorCode };

const DAY_MS = 24 * 60 * 60 * 1000;

// One pass of misuse detection (C4, M1-M7, M10): reads ESPN's transaction log over the days since
// its last pass, the activity feed over the same time, the league's privacy and this week's
// adjustments, and records an alert, emailed once, for each league-manager action the app's own
// records don't account for. Its first pass lists what was already on ESPN without emailing
// (OQ18). A pass that can't read ESPN pauses the watch, and says so (M6, Dec-D32c).
export async function runDetectionPass(context: DetectionContext): Promise<DetectionResult> {
  const { db } = context.connection;
  const watch = await getMisuseWatch(db);
  const firstRun = watch === null || watch.firstRunAt === null;
  const window = scanWindow(watch, context.now);
  const read = await readLeague(context, window);
  if ("code" in read) return pauseWatch(context, read);
  const today = read.value.week.week.todayScoringPeriodId;
  const findings = await findingsOf(context, read.value, { firstRun, since: window.since });
  const names = namesOnce(context);
  const alertsCreated = await recordFindings(context, findings, { firstRun, names });
  await recordMisuseWatch(db, {
    state: "working",
    code: null,
    checkedAt: context.now,
    scannedThroughDay: today,
    teamMoves: await commissionerTeamMoves(context, read.value.transactions, names),
    ...(firstRun ? { firstRunAt: context.now } : {}),
  });
  return { kind: "watched", alertsCreated };
}

// From the day before the last one read through, or from the season's first day on a first run;
// the feed over the same days, and a day more.
function scanWindow(watch: MisuseWatchRecord | null, now: Date) {
  const through = watch === null || watch.firstRunAt === null ? null : watch.scannedThroughDay;
  const firstDay = through === null ? 1 : Math.max(1, through - 1);
  return {
    firstDay,
    since: (today: number) => new Date(now.getTime() - (today - firstDay + 2) * DAY_MS),
  };
}

// Which read failed: the league's week read, which records the league's ESPN access as the
// executor's reads do, or one of detection's own reads, which records nothing, since the league
// reads requests wait on still work (O4).
type ReadFailure = { code: EspnErrorCode; failedRead: "league" | "monitoring" };

async function readLeague(
  context: DetectionContext,
  window: ReturnType<typeof scanWindow>
): Promise<{ value: LeagueRead } | ReadFailure> {
  const week = await readEspn(context, () => context.espn.getCurrentWeek());
  if ("code" in week) return { code: week.code, failedRead: "league" };
  const today = week.value.week.todayScoringPeriodId;
  try {
    const { monitor } = context;
    const transactions: LeagueTransaction[] = [];
    for (let day = Math.min(window.firstDay, today); day <= today; day += 1) {
      transactions.push(...(await monitor.getTransactions(day)));
    }
    const activity = await monitor.getLeagueActivity({
      from: window.since(today),
      to: context.now,
    });
    const { isPublic } = await monitor.getLeaguePrivacy();
    const value = {
      week: week.value,
      transactions: uniqueById(transactions),
      ...activity,
      isPublic,
    };
    return { value };
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    return { code: error.code, failedRead: "monitoring" };
  }
}

// A day's log also lists records made that day for a later day, which that day's read lists again.
function uniqueById(transactions: readonly LeagueTransaction[]): LeagueTransaction[] {
  return [...new Map(transactions.map((each) => [each.transactionId, each])).values()];
}

async function findingsOf(
  context: DetectionContext,
  read: LeagueRead,
  scan: { firstRun: boolean; since: (today: number) => Date }
): Promise<Finding[]> {
  const records = await appRecords(context.connection.db, read, scan.since);
  const lookups = { now: context.now, records, firstRun: scan.firstRun };
  return [
    ...lineupFindings(read.transactions, lookups),
    ...adjustmentFindings(read, lookups),
    ...leagueFindings(read, context.now),
    ...mismatchFindings(read.week, records, context.now),
  ];
}

async function appRecords(
  db: DatabaseExecutor,
  read: LeagueRead,
  since: (today: number) => Date
): Promise<AppRecords> {
  const from = since(read.week.week.todayScoringPeriodId);
  const writes = sentWritesOf(await listSentEspnWritesSince(db, new Date(from.getTime() - DAY_MS)));
  return {
    ...writes,
    completions: completionsOf(
      await listByHandCompletionsSince(db, new Date(from.getTime() - DAY_MS))
    ),
    periodRequests: await listMatchupPeriodRequests(db, {
      season: read.week.meta.season,
      matchupPeriodId: read.week.week.matchupPeriodId,
    }),
  };
}

// Records each finding, emailing the commissioner about each new one that isn't accounted for,
// except on the first run. Returns how many alerts were new.
async function recordFindings(
  context: DetectionContext,
  findings: readonly Finding[],
  { firstRun, names: readNames }: { firstRun: boolean; names: () => Promise<LeagueNames> }
): Promise<number> {
  if (findings.length === 0) return 0;
  const names = await readNames();
  let created = 0;
  for (const finding of findings) {
    const recorded = await context.connection.transaction(async (tx) => {
      const alert = await recordOne(tx, finding, { names, now: context.now, firstRun });
      if (!alert.created || finding.acknowledged !== null || firstRun) return alert.created;
      await emailAlert(tx, alert.alert, context.now);
      return true;
    });
    if (recorded) created += 1;
  }
  if (created > 0) context.logger.warn("worker.misuse_watch.alerts", { created });
  return created;
}

async function recordOne(
  tx: DatabaseExecutor,
  finding: Finding,
  options: { names: LeagueNames; now: Date; firstRun: boolean }
) {
  const { what, undo } = describeFinding(finding.facts, finding.teamId, options.names);
  const acknowledged = finding.acknowledged;
  return recordMisuseAlert(tx, {
    alertId: randomUUID(),
    espnRef: finding.espnRef,
    kind: finding.kind,
    teamId: finding.teamId,
    teamName: finding.teamId === null ? null : options.names.teamName(finding.teamId),
    espnAt: finding.espnAt,
    details: { what, undo, ...detailsOf(finding) },
    foundAt: options.now,
    foundBeforeWatch: options.firstRun,
    acknowledgedAt: acknowledged === null ? null : options.now,
    matchedRequestId: acknowledged?.matchedRequestId ?? null,
    acknowledgedNote: acknowledged?.note ?? null,
  });
}

// The facts behind the text, kept for the record.
function detailsOf(finding: Finding): Record<string, unknown> {
  const { facts } = finding;
  if (facts.kind === "adjustment_mismatch") {
    const { matchupId, period, expectedTenths, actualTenths } = facts;
    return { matchupId, period, expectedTenths, actualTenths };
  }
  if (facts.kind === "lm_transaction") return { items: facts.transaction.items };
  if (facts.kind === "lm_adjustment") return { adjustment: facts.adjustment };
  return {};
}

async function emailAlert(
  tx: DatabaseExecutor,
  alert: Awaited<ReturnType<typeof recordMisuseAlert>>["alert"],
  now: Date
): Promise<void> {
  const commissioner = await findActiveCommissioner(tx);
  if (commissioner === null) return;
  const details = alert.details as { what: string; undo: string[] };
  const email = buildMisuseAlertOutboxEmail({
    to: commissioner.email,
    alertId: alert.alertId,
    teamName: alert.teamName ?? (alert.teamId === null ? null : `team ${alert.teamId}`),
    espnAt: alert.espnAt,
    what: details.what,
    undo: details.undo,
  });
  await enqueueEmail(tx, { emailId: randomUUID(), ...email, createdAt: now });
}

// The commissioner team's moves over the last day, newest first, whoever made them (D16, M9).
async function commissionerTeamMoves(
  context: DetectionContext,
  transactions: readonly LeagueTransaction[],
  names: () => Promise<LeagueNames>
) {
  const teamId = (await findActiveCommissioner(context.connection.db))?.teamId ?? null;
  const recent = transactions
    .filter((each) => each.teamId === teamId)
    .filter((each) => context.now.getTime() - each.proposedAt.getTime() < DAY_MS)
    .sort((a, b) => b.proposedAt.getTime() - a.proposedAt.getTime());
  if (recent.length === 0) return [];
  const { playerName } = await names();
  return recent.map((each) => ({
    at: each.proposedAt.toISOString(),
    type: each.type,
    byLeagueManager: each.byLeagueManager,
    items: each.items.map((item) => ({
      type: item.type,
      player: playerName(item.playerId) ?? `player ${item.playerId}`,
      fromSlot: lineupSlotNames[item.fromSlotId] ?? null,
      toSlot: lineupSlotNames[item.toSlotId] ?? null,
    })),
  }));
}

// One lineup read a pass at most, and only when something needs a name.
function namesOnce(context: DetectionContext): () => Promise<LeagueNames> {
  let names: Promise<LeagueNames> | undefined;
  return () => {
    names ??= leagueNames(context);
    return names;
  };
}

// ESPN's names for the alerts' text; numbers instead when the lineup read fails.
async function leagueNames(context: DetectionContext): Promise<LeagueNames> {
  try {
    const { teams } = await context.espn.getLineups();
    const players = new Map<number, string>();
    for (const team of teams) {
      for (const slot of [...team.starters, ...team.bench, ...team.injuredReserve]) {
        if (slot.player !== null) players.set(slot.player.playerId, slot.player.name);
      }
    }
    const teamNames = new Map(teams.map((team) => [team.teamId, team.teamName]));
    return {
      teamName: (teamId) => teamNames.get(teamId) ?? null,
      playerName: (playerId) => players.get(playerId) ?? null,
    };
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    return { teamName: () => null, playerName: () => null };
  }
}

// The watch can't read ESPN. A cookie refused on the league's read has its one email, the
// credentials email readEspn sent at the refusal's start, whichever loop saw it first; any other
// failure, a cookie refused on one of detection's own reads included (the league reads still take
// it), emails that the watch is paused, once per pause (M6, Dec-D32c).
async function pauseWatch(
  context: DetectionContext,
  { code, failedRead }: ReadFailure
): Promise<DetectionResult> {
  const state = espnAccessStateFor(code);
  await context.connection.transaction(async (tx) => {
    const { watch, startedNow } = await recordMisuseWatch(tx, {
      state,
      code,
      checkedAt: context.now,
    });
    if (!startedNow || (state === "credentials_rejected" && failedRead === "league")) return;
    const commissioner = await findActiveCommissioner(tx);
    if (commissioner === null) return;
    const email = buildWatchPausedOutboxEmail({ to: commissioner.email, since: watch.since });
    await enqueueEmail(tx, { emailId: randomUUID(), ...email, createdAt: context.now });
  });
  context.logger.warn("worker.misuse_watch.paused", { code });
  return { kind: "paused", code };
}

// Detection reads the real league, so it runs only where ESPN is read live, with the cookie.
export function detectionTasks(input: {
  mode: EspnMode;
  run: () => Promise<void>;
}): ScheduledTask[] {
  return input.mode === "live" ? [{ name: "misuse_watch", run: input.run }] : [];
}
