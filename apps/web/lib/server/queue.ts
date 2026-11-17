import {
  type DatabaseExecutor,
  describeFailure,
  getEspnAccess,
  getLatestWorkerHeartbeat,
  getMisuseWatch,
  getRequestDetail,
  isDatabaseQueryError,
  listCommissionerQueue,
  listOpenMisuseAlerts,
  listTeamNames,
  type MisuseAlertRecord,
  NEEDS_THE_COMMISSIONER,
  type RequestDetail,
  readLeagueRulesCheck,
  readLeagueSettings,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  confirmedPlanOf,
  type EspnAccessState,
  espnBlockFor,
  isWorkerDown,
  type MisuseAlertKind,
  type ReviewReason,
  requestAmountTenths,
  type SubRequestStatus,
} from "@injurysub/domain";
import type { RuleMismatch } from "@injurysub/espn";
import { z } from "zod";
import {
  automationSwitchOf,
  type PageAutomation,
  type WatchState,
  watchStateOf,
} from "./commish-alerts";
import { heldAmountOf } from "./commish-approval";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";
import { namesIn } from "./request-view";

// What a "Needs you" row's sentence names (FS-QUEUE-5), from the request's own record.
export type ReviewFacts = {
  // When the request came to the commissioner (a refused lineup's time).
  reviewedAt: Date | null;
  // A rearrangement's other starters' moves, in the order confirmed.
  otherMoves: { name: string; toSlot: string }[];
  // The adjustment the worker sent before ESPN refused it.
  sentTenths: number | null;
  // An approved amount, and the amount it changed to.
  approvedTenths: number | null;
  heldTenths: number | null;
  // What differed when the adjustment was held.
  mismatches: RuleMismatch[];
};

export type QueueRequest = {
  kind: "request";
  requestId: string;
  teamId: number;
  teamName: string | null;
  injured: { playerId: number; name: string };
  replacement: { playerId: number; name: string };
  status: SubRequestStatus;
  reviewReason: ReviewReason | null;
  filedAt: Date;
  expiresAt: Date | null;
  matchupPeriodId: number;
  amountTenths: number | null;
  amountFinal: boolean;
  // Facts for a request waiting on the commissioner; null for the rest.
  facts: ReviewFacts | null;
};

export type QueueAlert = {
  kind: "alert";
  alertId: string;
  alertKind: MisuseAlertKind;
  teamId: number | null;
  teamName: string | null;
  at: Date;
};

export type QueueHealth = {
  espn: { state: EspnAccessState; since: Date; checkedAt: Date } | null;
  // Requests in line or in progress that ESPN's access holds up.
  blockedCount: number;
  worker: { lastBeatAt: Date | null; down: boolean };
  rules: { mismatches: RuleMismatch[]; checkedAt: Date; lastMatchedAt: Date | null } | null;
  watch: WatchState;
};

export type QueueAutomation = Exclude<PageAutomation, { status: "unavailable" }>;

export type Queue =
  | { status: "unavailable" }
  | {
      status: "found";
      health: QueueHealth;
      automation: QueueAutomation;
      // Requests and misuse alerts waiting on the commissioner, oldest first (FS-QUEUE-3).
      needsYou: (QueueRequest | QueueAlert)[];
      // Every other request, newest first.
      rest: QueueRequest[];
    };

// The commissioner's queue, from what the database holds: no ESPN read (Revision 2).
export async function loadQueue({ now }: { now: Date }): Promise<Queue> {
  try {
    return { status: "found", ...(await readQueue(getWebDatabaseConnection().db, now)) };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.commish.database_failed", undefined, {
      flow: "queue",
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

async function readQueue(db: DatabaseExecutor, now: Date) {
  const rows = await listCommissionerQueue(db);
  const names = new Map((await listTeamNames(db)).map((team) => [team.teamId, team.name]));
  const health = await readHealth(db, rows, now);
  const waiting = rows.filter((row) => NEEDS_THE_COMMISSIONER.includes(row.status));
  const requests = await Promise.all(
    waiting.map(async (row) =>
      requestOf(row, names, reviewFactsOf(await getRequestDetail(db, row.requestId)))
    )
  );
  const alerts = (await listOpenMisuseAlerts(db)).map((alert) => alertOf(alert, names));
  const settings = await readLeagueSettings(db);
  return {
    health,
    automation: { ...automationSwitchOf(settings), changedAt: settings.automationChangedAt },
    needsYou: [...requests, ...alerts].sort((a, b) => timeOf(a) - timeOf(b)),
    rest: rows
      .filter((row) => !NEEDS_THE_COMMISSIONER.includes(row.status))
      .map((row) => requestOf(row, names, null)),
  };
}

async function readHealth(
  db: DatabaseExecutor,
  rows: SubRequestRecord[],
  now: Date
): Promise<QueueHealth> {
  const access = await getEspnAccess(db);
  const beat = await getLatestWorkerHeartbeat(db);
  const rules = await readLeagueRulesCheck(db);
  const state = access?.state ?? null;
  return {
    espn:
      access === null
        ? null
        : { state: access.state, since: access.since, checkedAt: access.checkedAt },
    blockedCount: rows.filter((row) => espnBlockFor(row.status, state) !== null).length,
    worker: { lastBeatAt: beat?.beatAt ?? null, down: isWorkerDown(beat?.beatAt ?? null, now) },
    rules: rules === null ? null : { ...rules, mismatches: mismatchesOf(rules.mismatches) },
    watch: watchStateOf(await getMisuseWatch(db)),
  };
}

function timeOf(row: QueueRequest | QueueAlert): number {
  return (row.kind === "alert" ? row.at : row.filedAt).getTime();
}

function requestOf(
  row: SubRequestRecord,
  names: ReadonlyMap<number, string>,
  facts: ReviewFacts | null
): QueueRequest {
  return {
    kind: "request",
    requestId: row.requestId,
    teamId: row.teamId,
    teamName: names.get(row.teamId) ?? null,
    injured: { playerId: row.injuredPlayerId, name: row.injuredName },
    replacement: { playerId: row.replacementPlayerId, name: row.replacementName },
    status: row.status,
    reviewReason: row.reviewReason,
    filedAt: row.filedAt,
    expiresAt: row.expiresAt,
    matchupPeriodId: row.matchupPeriodId,
    amountTenths: requestAmountTenths(row),
    amountFinal: row.finalAdjustmentTenths !== null,
    facts,
  };
}

function alertOf(alert: MisuseAlertRecord, names: ReadonlyMap<number, string>): QueueAlert {
  return {
    kind: "alert",
    alertId: alert.alertId,
    alertKind: alert.kind,
    teamId: alert.teamId,
    teamName: alert.teamName ?? (alert.teamId === null ? null : (names.get(alert.teamId) ?? null)),
    at: alert.espnAt ?? alert.foundAt,
  };
}

const sentSchema = z.object({ finalTenths: z.number().int() });
const heldMismatchesSchema = z.object({ mismatches: z.array(z.unknown()) });
const ruleMismatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("setting"),
    setting: z.string(),
    expected: z.string(),
    espn: z.string(),
  }),
  z.object({
    kind: z.literal("day-points"),
    teamId: z.number(),
    playerId: z.number(),
    name: z.string(),
    scoringPeriodId: z.number(),
    formulaPoints: z.number(),
    espnPoints: z.number(),
  }),
]);

// The mismatches a stored check or a hold kept; any it can't read are left out.
function mismatchesOf(stored: unknown[]): RuleMismatch[] {
  return stored.flatMap((each) => {
    const parsed = ruleMismatchSchema.safeParse(each);
    return parsed.success ? [parsed.data] : [];
  });
}

// What a waiting request's sentence names, from its record; the detail page shows the same.
export function reviewFactsOf(detail: RequestDetail | null): ReviewFacts | null {
  if (detail === null) return null;
  const { request, events } = detail;
  const review = events.findLast((each) => each.eventType === "sent_to_review");
  const sent = sentSchema.safeParse(
    events.findLast((each) => each.eventType === "adjustment_sent")?.payload
  );
  const held = heldMismatchesSchema.safeParse(review?.payload);
  return {
    reviewedAt: review?.createdAt ?? null,
    otherMoves: otherMovesOf(detail),
    sentTenths: sent.success ? sent.data.finalTenths : null,
    approvedTenths: request.approvedComputedTenths,
    heldTenths: heldAmountOf(events),
    mismatches: held.success ? mismatchesOf(held.data.mismatches) : [],
  };
}

// The confirmed plan moves the injured starter first and the replacement last; the rest are the
// other starters a rearrangement would move.
function otherMovesOf({ request, snapshots }: RequestDetail): ReviewFacts["otherMoves"] {
  const filed = snapshots.find((each) => each.phase === "request");
  const plan = confirmedPlanOf(filed?.payload);
  if (plan === null) return [];
  const names = namesIn(request, snapshots);
  return plan.slice(1, -1).map(({ playerId, toSlot }) => ({
    name: names.get(playerId) ?? `player ${playerId}`,
    toSlot,
  }));
}
