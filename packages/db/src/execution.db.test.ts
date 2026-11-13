import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import {
  acquireWriteLease,
  listWriteAttempts,
  type NewWriteAttempt,
  recordWriteAnswer,
  recordWriteAttempt,
  recordWriteReadback,
  releaseWriteLease,
  renewWriteLease,
} from "./execution";
import { createRequest } from "./requests";
import { espnWriteLock, espnWrites, userAccounts } from "./schema";
import { dbTest } from "./test-support";

const now = new Date("2026-11-13T18:00:00.000Z");

async function expireLease(db: DatabaseExecutor) {
  await db.update(espnWriteLock).set({ expiresAt: sql`now() - interval '1 second'` });
}

// An invented manager's request on team 1, for attempts to belong to.
async function insertRequest(db: DatabaseExecutor): Promise<string> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `manager-${userId}@example.test`,
    teamId: 1,
    displayName: "Invented Person",
    role: "manager",
  });
  const requestId = randomUUID();
  await createRequest(db, {
    request: {
      requestId,
      kind: "substitution",
      teamId: 1,
      season: 2027,
      matchupPeriodId: 5,
      matchupId: 52,
      requestedBy: userId,
      idempotencyKey: randomUUID(),
      injuredPlayerId: 2,
      injuredName: "Invented Starter",
      injuredSlot: "C",
      replacementPlayerId: 20,
      replacementName: "Invented Bench",
      requestMoment: now,
      filedAt: now,
      requestDay: 26,
      designationAtRequest: "OUT",
      status: "executing",
      executionModeAtRequest: "auto",
      createdAt: now,
    },
    snapshot: { snapshotId: randomUUID(), espnDay: 26, takenAt: now, payload: {} },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: userId,
      eventType: "request_filed",
      payload: {},
      createdAt: now,
    },
    email: null,
  });
  return requestId;
}

function attempt(requestId: string): NewWriteAttempt {
  return {
    writeId: randomUUID(),
    requestId,
    kind: "lineup",
    teamId: 1,
    matchupId: null,
    scoringPeriodId: 26,
    body: { teamId: 1, items: [{ playerId: 2 }, { playerId: 20 }] },
  };
}

describe("the ESPN write lease", () => {
  dbTest("goes to exactly one of five simultaneous acquirers", async ({ database }) => {
    const { connection } = database;

    const leases = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        acquireWriteLease(connection.db, { holder: `worker-${index}`, ttlSeconds: 60 })
      )
    );

    const held = leases.filter((lease) => lease !== null);
    expect(held).toHaveLength(1);
    expect(await connection.db.select().from(espnWriteLock)).toEqual([
      expect.objectContaining({ holder: held[0]?.holder, token: held[0]?.token }),
    ]);
  });

  dbTest("is taken over once it expires, with a higher token", async ({ database }) => {
    const { db } = database.connection;
    const first = await acquireWriteLease(db, { holder: "old-worker", ttlSeconds: 60 });

    expect(await acquireWriteLease(db, { holder: "new-worker", ttlSeconds: 60 })).toBeNull();
    await expireLease(db);
    const second = await acquireWriteLease(db, { holder: "new-worker", ttlSeconds: 60 });

    expect(second?.holder).toBe("new-worker");
    expect(second?.token).toBeGreaterThan(first?.token ?? Number.POSITIVE_INFINITY);
  });

  dbTest("renews only for its holder's current token", async ({ database }) => {
    const { db } = database.connection;
    const old = await acquireWriteLease(db, { holder: "old-worker", ttlSeconds: 60 });
    await expireLease(db);
    const current = await acquireWriteLease(db, { holder: "new-worker", ttlSeconds: 60 });
    if (old === null || current === null) throw new Error("expected both leases");

    expect(await renewWriteLease(db, { ...old, ttlSeconds: 60 })).toBe(false);
    expect(
      await renewWriteLease(db, { holder: old.holder, token: current.token, ttlSeconds: 60 })
    ).toBe(false);
    expect(await renewWriteLease(db, { ...current, ttlSeconds: 60 })).toBe(true);
  });

  // A worker that lost its lease and took it again: work still carrying the old token is fenced.
  dbTest("refuses its own holder's earlier token after a takeover", async ({ database }) => {
    const { db } = database.connection;
    const earlier = await acquireWriteLease(db, { holder: "worker", ttlSeconds: 60 });
    await expireLease(db);
    const later = await acquireWriteLease(db, { holder: "worker", ttlSeconds: 60 });
    if (earlier === null || later === null) throw new Error("expected both leases");

    expect(await renewWriteLease(db, { ...earlier, ttlSeconds: 60 })).toBe(false);
    expect(await renewWriteLease(db, { ...later, ttlSeconds: 60 })).toBe(true);
  });

  dbTest("is released only by its holder, and then free to take", async ({ database }) => {
    const { db } = database.connection;
    const lease = await acquireWriteLease(db, { holder: "worker-a", ttlSeconds: 60 });
    if (lease === null) throw new Error("expected the lease");

    expect(await releaseWriteLease(db, { holder: "worker-b", token: lease.token })).toBe(false);
    expect(await acquireWriteLease(db, { holder: "worker-b", ttlSeconds: 60 })).toBeNull();
    expect(await releaseWriteLease(db, lease)).toBe(true);
    expect(await acquireWriteLease(db, { holder: "worker-b", ttlSeconds: 60 })).not.toBeNull();
  });
});

describe("ESPN write attempts", () => {
  // AC2-10: the row is committed before anything is sent, so in recovery no row means no send.
  dbTest(
    "records an attempt only under the current lease, committed before it returns",
    async ({ database }) => {
      const { db } = database.connection;
      const requestId = await insertRequest(db);
      const old = await acquireWriteLease(db, { holder: "old-worker", ttlSeconds: 60 });
      await expireLease(db);
      const current = await acquireWriteLease(db, { holder: "new-worker", ttlSeconds: 60 });
      if (old === null || current === null) throw new Error("expected both leases");

      const refused = await recordWriteAttempt(database.connection, {
        lease: old,
        ttlSeconds: 60,
        attempt: attempt(requestId),
      });
      const recorded = await recordWriteAttempt(database.connection, {
        lease: current,
        ttlSeconds: 60,
        attempt: attempt(requestId),
      });

      expect(refused).toBeNull();
      const elsewhere = await listWriteAttempts(database.connect().db, requestId);
      expect(elsewhere).toEqual([
        expect.objectContaining({
          writeId: recorded,
          status: "sending",
          fencingToken: current.token,
          body: { teamId: 1, items: [{ playerId: 2 }, { playerId: 20 }] },
          respondedAt: null,
        }),
      ]);
    }
  );

  dbTest("stores the answer, then the readback, with their times", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertRequest(db);
    const lease = await acquireWriteLease(db, { holder: "worker", ttlSeconds: 60 });
    if (lease === null) throw new Error("expected the lease");
    const writeId = await recordWriteAttempt(database.connection, {
      lease,
      ttlSeconds: 60,
      attempt: attempt(requestId),
    });
    if (writeId === null) throw new Error("expected the attempt");

    await recordWriteAnswer(db, writeId, { status: "failed", failureCode: "outcome_unknown" });
    await recordWriteReadback(db, writeId, {
      outcome: "verified",
      readback: { slots: { 2: "BE", 20: "C" } },
    });

    const [row] = await db.select().from(espnWrites);
    expect(row).toMatchObject({
      status: "failed",
      failureCode: "outcome_unknown",
      outcome: "verified",
      readback: { slots: { 2: "BE", 20: "C" } },
    });
    expect(row?.respondedAt).toBeInstanceOf(Date);
    expect(row?.readBackAt).toBeInstanceOf(Date);
  });
});
