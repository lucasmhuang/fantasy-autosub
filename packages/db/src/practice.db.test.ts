import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import { markEmptyDatabasePractice, readPracticeSince } from "./practice";
import { createRequest } from "./requests";
import { leagueSettings, userAccounts } from "./schema";
import { dbTest } from "./test-support";

const first = new Date("2026-11-16T02:00:00.000Z");
const later = new Date("2026-11-17T02:00:00.000Z");

async function insertRequest(db: DatabaseExecutor): Promise<void> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `manager-${userId}@example.test`,
    teamId: 1,
    displayName: "Invented Person",
    role: "manager",
  });
  await createRequest(db, {
    request: {
      requestId: randomUUID(),
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
}

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
