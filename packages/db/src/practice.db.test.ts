import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import { listVerifiedWrites, markEmptyDatabasePractice, readPracticeSince } from "./practice";
import { createRequest } from "./requests";
import { espnWrites, leagueSettings, userAccounts } from "./schema";
import { dbTest } from "./test-support";

const first = new Date("2026-11-16T02:00:00.000Z");
const later = new Date("2026-11-17T02:00:00.000Z");

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
      matchupPeriodId: 2,
      matchupId: 12,
      requestedBy: userId,
      idempotencyKey: randomUUID(),
      injuredPlayerId: 2,
      injuredName: "Invented Starter",
      injuredSlot: "C",
      replacementPlayerId: 20,
      replacementName: "Invented Bench",
      requestMoment: first,
      filedAt: first,
      requestDay: 8,
      designationAtRequest: "OUT",
      status: "withdrawn",
      executionModeAtRequest: "auto",
      createdAt: first,
    },
    snapshot: { snapshotId: randomUUID(), espnDay: 8, takenAt: first, payload: {} },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: userId,
      eventType: "request_filed",
      payload: {},
      createdAt: first,
    },
    email: null,
  });
  return requestId;
}

async function insertWrite(
  db: DatabaseExecutor,
  input: { requestId: string; sentAt: Date; outcome: "verified" | "not_applied" | null }
): Promise<string> {
  const writeId = randomUUID();
  await db.insert(espnWrites).values({
    writeId,
    requestId: input.requestId,
    kind: "lineup",
    teamId: 1,
    matchupId: 12,
    scoringPeriodId: 8,
    body: { sentAt: input.sentAt.toISOString() },
    fencingToken: 1,
    status: input.outcome === null ? "sending" : "answered",
    outcome: input.outcome,
    sentAt: input.sentAt,
  });
  return writeId;
}

describe("listVerifiedWrites", () => {
  dbTest("gives every write read back as applied, in the order sent", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertRequest(db);
    const third = await insertWrite(db, { requestId, sentAt: later, outcome: "verified" });
    await insertWrite(db, { requestId, sentAt: first, outcome: "not_applied" });
    const firstVerified = await insertWrite(db, {
      requestId,
      sentAt: new Date(first.getTime() - 60_000),
      outcome: "verified",
    });
    await insertWrite(db, { requestId, sentAt: later, outcome: null });

    expect(await listVerifiedWrites(db)).toEqual([
      { writeId: firstVerified, kind: "lineup", body: { sentAt: "2026-11-16T01:59:00.000Z" } },
      { writeId: third, kind: "lineup", body: { sentAt: later.toISOString() } },
    ]);
  });
});

describe("markEmptyDatabasePractice", () => {
  dbTest(
    "marks a database that has never held a request as a practice one, and keeps the first mark",
    async ({ database }) => {
      const { db } = database.connection;
      expect(await readPracticeSince(db)).toBe(null);

      expect(await markEmptyDatabasePractice(db, first)).toEqual(first);
      expect(await markEmptyDatabasePractice(db, later)).toEqual(first);
      expect(await readPracticeSince(db)).toEqual(first);
    }
  );

  dbTest("marks one whose settings were saved before", async ({ database }) => {
    const { db } = database.connection;
    await db.insert(leagueSettings).values({});

    expect(await markEmptyDatabasePractice(db, first)).toEqual(first);
    expect(await readPracticeSince(db)).toEqual(first);
  });

  dbTest("keeps a practice database's mark once it holds requests", async ({ database }) => {
    const { db } = database.connection;
    await markEmptyDatabasePractice(db, first);
    await insertRequest(db);

    expect(await markEmptyDatabasePractice(db, later)).toEqual(first);
  });

  // Every ESPN write belongs to a request, so a database without one has none either.
  dbTest("leaves a database that holds a request unmarked", async ({ database }) => {
    const { db } = database.connection;
    await insertRequest(db);

    expect(await markEmptyDatabasePractice(db, first)).toBe(null);
    expect(await readPracticeSince(db)).toBe(null);
  });

  dbTest(
    "leaves a database that holds a request unmarked, its settings saved before",
    async ({ database }) => {
      const { db } = database.connection;
      await db.insert(leagueSettings).values({});
      await insertRequest(db);

      expect(await markEmptyDatabasePractice(db, first)).toBe(null);
      expect(await readPracticeSince(db)).toBe(null);
    }
  );
});
