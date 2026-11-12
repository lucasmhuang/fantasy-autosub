import { randomUUID } from "node:crypto";
import { createLogger } from "@injurysub/config";
import {
  createRequest,
  type DatabaseExecutor,
  emailOutbox,
  getRequestDetail,
  type NewSubRequest,
  userAccounts,
} from "@injurysub/db";
import { type CurrentWeekRead, EspnError } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { sweepWaitingRequests, type WeekSource } from "./expiry";
import { dbTest } from "./test-support";

const now = new Date("2026-11-05T20:00:00.000Z");
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Invented people only.
async function insertAccount(
  db: DatabaseExecutor,
  role: "manager" | "commissioner",
  teamId: number
) {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `${role}-${userId}@example.test`,
    teamId,
    displayName: "Invented Person",
    role,
  });
  return userId;
}

// One manager per test: the team holds one active account.
const managers = new WeakMap<object, string>();

async function insertWaiting(db: DatabaseExecutor, overrides: Partial<NewSubRequest>) {
  const requestedBy = managers.get(db) ?? (await insertAccount(db, "manager", 5));
  managers.set(db, requestedBy);
  const request = waitingRequest(requestedBy, overrides);
  await createRequest(db, {
    request,
    snapshot: { snapshotId: randomUUID(), espnDay: 15, takenAt: now, payload: {} },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: requestedBy,
      eventType: "request_filed",
      payload: {},
      createdAt: request.createdAt ?? now,
    },
    email: null,
  });
  return request.requestId;
}

// Team 5's request, awaiting approval, filed an hour ago and expiring in 11 hours.
function waitingRequest(requestedBy: string, overrides: Partial<NewSubRequest>): NewSubRequest {
  return {
    requestId: randomUUID(),
    kind: "substitution",
    teamId: 5,
    season: 2027,
    matchupPeriodId: 3,
    matchupId: 31,
    requestedBy,
    idempotencyKey: randomUUID(),
    injuredPlayerId: 2,
    injuredName: "Invented Starter",
    injuredSlot: "G",
    replacementPlayerId: 20,
    replacementName: "Invented Bench",
    requestMoment: minutesFromNow(-60),
    filedAt: minutesFromNow(-60),
    requestDay: 15,
    designationAtRequest: "OUT",
    status: "awaiting_approval",
    executionModeAtRequest: "approval_required",
    expiresAt: minutesFromNow(11 * 60),
    projectedAdjustmentTenths: 51,
    createdAt: minutesFromNow(-60),
    ...overrides,
  };
}

// ESPN's current week: matchup period `period`, days 14-20, today 16.
function weekOf(period: number): WeekSource {
  const read = {
    meta: {
      source: "recorded",
      season: 2027,
      matchupPeriodId: period,
      scoringPeriodId: 16,
      readAt: now.toISOString(),
    },
    week: {
      matchupPeriodId: period,
      scoringPeriodIds: [14, 15, 16, 17, 18, 19, 20],
      completeScoringPeriodIds: [14, 15],
      todayScoringPeriodId: 16,
      matchups: [],
    },
  } satisfies CurrentWeekRead;
  return { mode: "stub", getCurrentWeek: async () => read };
}

async function stateOf(db: DatabaseExecutor, requestId: string) {
  const detail = await getRequestDetail(db, requestId);
  return {
    status: detail?.request.status,
    reviewReason: detail?.request.reviewReason,
    events: detail?.events.map((event) => [event.actorType, event.eventType]),
  };
}

const logger = createLogger("worker", "debug");

describe("sweepWaitingRequests", () => {
  dbTest(
    "sends a request past its expiry to review, with an event and the commissioner's email",
    async ({ database }) => {
      const { connection } = database;
      const commissioner = await insertAccount(connection.db, "commissioner", 1);
      const requestId = await insertWaiting(connection.db, { expiresAt: minutesFromNow(-1) });

      await sweepWaitingRequests({ connection, espn: weekOf(3), logger, now });

      expect(await stateOf(connection.db, requestId)).toEqual({
        status: "needs_review",
        reviewReason: "expired",
        events: [
          ["manager", "request_filed"],
          ["system", "expired"],
        ],
      });
      const [email] = await connection.db.select().from(emailOutbox);
      expect(email).toMatchObject({
        dedupeKey: `${requestId}:1`,
        toAddress: `commissioner-${commissioner}@example.test`,
      });
      expect(email?.body).toContain("waited past its window");
    }
  );

  dbTest(
    "leaves a request whose expiry is still ahead, however long ago its stated moment",
    async ({ database }) => {
      const { connection } = database;
      // An on-behalf request stated 13 h ago and filed a minute ago, and one filed 13 h ago and
      // approved a minute ago: both have their expiry reset ahead.
      const onBehalf = await insertWaiting(connection.db, {
        kind: "on_behalf",
        requestMoment: minutesFromNow(-13 * 60),
        filedAt: minutesFromNow(-1),
        expiresAt: minutesFromNow(12 * 60 - 1),
      });
      const approved = await insertWaiting(connection.db, {
        status: "queued",
        injuredPlayerId: 3,
        filedAt: minutesFromNow(-13 * 60),
        expiresAt: minutesFromNow(1),
      });

      await sweepWaitingRequests({ connection, espn: weekOf(3), logger, now });

      expect((await stateOf(connection.db, onBehalf)).status).toBe("awaiting_approval");
      expect((await stateOf(connection.db, approved)).status).toBe("queued");
      expect(await connection.db.select().from(emailOutbox)).toEqual([]);
    }
  );

  dbTest(
    "sends a request whose matchup has ended to review as week_ended",
    async ({ database }) => {
      const { connection } = database;
      await insertAccount(connection.db, "commissioner", 1);
      const requestId = await insertWaiting(connection.db, {
        status: "queued",
        expiresAt: minutesFromNow(-1),
      });

      await sweepWaitingRequests({ connection, espn: weekOf(4), logger, now });

      expect(await stateOf(connection.db, requestId)).toMatchObject({
        status: "needs_review",
        reviewReason: "week_ended",
      });
    }
  );

  dbTest("checks expiry alone without ESPN, or when ESPN fails", async ({ database }) => {
    const { connection } = database;
    const expired = await insertWaiting(connection.db, { expiresAt: minutesFromNow(-1) });
    const current = await insertWaiting(connection.db, { injuredPlayerId: 3 });
    const failing: WeekSource = {
      mode: "live",
      getCurrentWeek: async () => {
        throw new EspnError(
          "espn_unavailable",
          "ESPN didn't answer (reading the current matchup week)"
        );
      },
    };

    await sweepWaitingRequests({
      connection,
      espn: { mode: "none", getCurrentWeek: weekOf(4).getCurrentWeek },
      logger,
      now,
    });
    await sweepWaitingRequests({ connection, espn: failing, logger, now });

    expect((await stateOf(connection.db, expired)).reviewReason).toBe("expired");
    expect((await stateOf(connection.db, current)).status).toBe("awaiting_approval");
  });
});
