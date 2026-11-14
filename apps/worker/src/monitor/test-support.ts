import { randomUUID } from "node:crypto";
import { createLogger } from "@injurysub/config";
import {
  createRequest,
  type DatabaseConnection,
  emailOutbox,
  listAcknowledgedMisuseAlerts,
  listOpenMisuseAlerts,
  type NewSubRequest,
  recordMisuseWatch,
  userAccounts,
} from "@injurysub/db";
import {
  createEspnReadClient,
  EspnError,
  type EspnErrorCode,
  type EspnMonitoringClient,
  type EspnReadOnlyClient,
  type FeedAdjustment,
  type FeedLeagueChange,
  type LeagueTransaction,
} from "@injurysub/espn";
import type { DetectionContext } from "./detection";

// What the league's transaction log, activity feed and privacy setting hold, for detection tests.
export type FakeMonitor = {
  transactions: LeagueTransaction[];
  adjustments: FeedAdjustment[];
  leagueChanges: FeedLeagueChange[];
  isPublic: boolean;
  failWith: EspnErrorCode | null;
  client: EspnMonitoringClient;
};

export function createFakeMonitor(): FakeMonitor {
  const fake: FakeMonitor = {
    transactions: [],
    adjustments: [],
    leagueChanges: [],
    isPublic: false,
    failWith: null,
    client: {
      getTransactions: async (day) => {
        refuseIfFailing(fake);
        return fake.transactions.filter((each) => each.scoringPeriodId === day);
      },
      getLeagueActivity: async () => {
        refuseIfFailing(fake);
        return { adjustments: fake.adjustments, leagueChanges: fake.leagueChanges };
      },
      getLeaguePrivacy: async () => {
        refuseIfFailing(fake);
        return { isPublic: fake.isPublic };
      },
    },
  };
  return fake;
}

function refuseIfFailing(fake: FakeMonitor): void {
  if (fake.failWith !== null) throw new EspnError(fake.failWith, `invented ${fake.failWith}`);
}

// The recorded league's ESPN day 8 (2026-10-27), when its week read was captured.
export const now = new Date("2026-10-27T20:00:00.000Z");
export const minutesFrom = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

export type DetectionSetup = {
  connection: DatabaseConnection;
  monitor: FakeMonitor;
  commissioner: string;
  context: (at?: Date) => DetectionContext;
};

// A league with a commissioner, whose misuse watch already ran (so this pass isn't its first)
// unless `firstRun`.
export async function setUpDetection(
  connection: DatabaseConnection,
  options: { firstRun?: boolean } = {}
): Promise<DetectionSetup> {
  const commissioner = randomUUID();
  await connection.db.insert(userAccounts).values({
    userId: commissioner,
    email: `commissioner-${commissioner}@example.test`,
    teamId: 1,
    displayName: "Invented Commissioner",
    role: "commissioner",
  });
  if (options.firstRun !== true) {
    const earlier = minutesFrom(now, -5);
    await recordMisuseWatch(connection.db, {
      state: "working",
      code: null,
      checkedAt: earlier,
      scannedThroughDay: 8,
      firstRunAt: earlier,
    });
  }
  const monitor = createFakeMonitor();
  const espn = sameEspnAs(monitor, createEspnReadClient({ mode: "stub" }));
  const logger = createLogger("worker", "error");
  return {
    connection,
    monitor,
    commissioner,
    context: (at = now) => ({ connection, espn, monitor: monitor.client, now: at, logger }),
  };
}

// One ESPN, one cookie: the league reads fail with the monitoring reads.
function sameEspnAs(
  monitor: FakeMonitor,
  read: EspnReadOnlyClient
): Pick<EspnReadOnlyClient, "getCurrentWeek" | "getLineups"> {
  return {
    getCurrentWeek: async () => {
      refuseIfFailing(monitor);
      return read.getCurrentWeek();
    },
    getLineups: async () => {
      refuseIfFailing(monitor);
      return read.getLineups();
    },
  };
}

export async function emailsSent(setup: DetectionSetup) {
  return setup.connection.db.select().from(emailOutbox);
}

export async function alertsOf(setup: DetectionSetup) {
  const { db } = setup.connection;
  return {
    open: await listOpenMisuseAlerts(db),
    acknowledged: await listAcknowledgedMisuseAlerts(db, 50),
  };
}

// A league-manager lineup edit on ESPN, at `at`, on `teamId`'s day 8.
export function lmEdit(
  teamId: number,
  at: Date,
  items: { playerId: number; fromSlotId: number; toSlotId: number }[],
  overrides: Partial<LeagueTransaction> = {}
): LeagueTransaction {
  return {
    transactionId: randomUUID(),
    type: "ROSTER",
    status: "EXECUTED",
    teamId,
    scoringPeriodId: 8,
    byLeagueManager: true,
    proposedAt: at,
    items: items.map((item) => ({ type: "LINEUP", fromTeamId: 0, toTeamId: 0, ...item })),
    ...overrides,
  };
}

// A settled or waiting request of matchup period 2 with the given fields, recorded with a request
// snapshot holding its confirmed plan.
export async function insertRequest(
  setup: DetectionSetup,
  overrides: Partial<NewSubRequest>,
  plan: { playerId: number; fromSlot: string; toSlot: string }[] | null = null
): Promise<string> {
  const requestId = randomUUID();
  await createRequest(setup.connection.db, {
    request: requestRow(setup, requestId, overrides),
    snapshot: {
      snapshotId: randomUUID(),
      espnDay: 8,
      takenAt: minutesFrom(now, -120),
      payload: plan === null ? {} : { plan },
    },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: setup.commissioner,
      eventType: "request_filed",
      payload: {},
      createdAt: minutesFrom(now, -120),
    },
    email: null,
  });
  return requestId;
}

function requestRow(
  setup: DetectionSetup,
  requestId: string,
  overrides: Partial<NewSubRequest>
): NewSubRequest {
  return {
    requestId,
    kind: "substitution",
    teamId: 2,
    season: 2027,
    matchupPeriodId: 2,
    matchupId: 0,
    requestedBy: setup.commissioner,
    idempotencyKey: randomUUID(),
    injuredPlayerId: 1,
    injuredName: "Invented Starter",
    injuredSlot: "PG",
    replacementPlayerId: 2,
    replacementName: "Invented Replacement",
    requestMoment: minutesFrom(now, -120),
    filedAt: minutesFrom(now, -120),
    requestDay: 8,
    designationAtRequest: "OUT",
    status: "completed",
    executionModeAtRequest: "approval_required",
    createdAt: minutesFrom(now, -120),
    updatedAt: minutesFrom(now, -120),
    ...overrides,
  };
}
