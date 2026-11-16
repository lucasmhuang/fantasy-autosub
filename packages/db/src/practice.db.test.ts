import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import {
  countPracticeReset,
  listVerifiedWrites,
  markEmptyDatabasePractice,
  readPracticeResetStanding,
  readPracticeSince,
  resetPracticeDatabase,
} from "./practice";
import { createRequest } from "./requests";
import {
  emailOutbox,
  espnWrites,
  leagueSettings,
  misuseAlerts,
  subRequestEvents,
  subRequestSnapshots,
  subRequests,
  userAccounts,
} from "./schema";
import { readSeasonEnd, recordSeasonEnd } from "./settings";
import { dbTest } from "./test-support";

const first = new Date("2026-11-16T02:00:00.000Z");
const later = new Date("2026-11-17T02:00:00.000Z");

async function insertRequest(db: DatabaseExecutor, teamId = 1): Promise<string> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `manager-${userId}@example.test`,
    teamId,
    displayName: "Invented Person",
    role: "manager",
  });
  const requestId = randomUUID();
  await createRequest(db, {
    request: {
      requestId,
      kind: "substitution",
      teamId,
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
  input: {
    requestId: string;
    sentAt: Date;
    outcome: "verified" | "not_applied" | null;
    status?: "sending" | "answered" | "failed" | "recorded_only";
  }
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
    status: input.status ?? (input.outcome === null ? "sending" : "answered"),
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

async function insertOutboxEmail(db: DatabaseExecutor, requestId: string | null): Promise<string> {
  const emailId = randomUUID();
  await db.insert(emailOutbox).values({
    emailId,
    dedupeKey: `invented:${emailId}`,
    toAddress: "commissioner@example.test",
    subject: "Invented",
    body: "Invented",
    requestId,
  });
  return emailId;
}

async function insertMatchedAlert(db: DatabaseExecutor, requestId: string): Promise<string> {
  const alertId = randomUUID();
  await db.insert(misuseAlerts).values({
    alertId,
    espnRef: `invented-${alertId}`,
    kind: "lm_transaction",
    details: {},
    foundAt: first,
    matchedRequestId: requestId,
  });
  return alertId;
}

describe("readPracticeResetStanding", () => {
  dbTest("reads a marked database as a practice one", async ({ database }) => {
    const { db } = database.connection;
    await markEmptyDatabasePractice(db, first);
    await insertWrite(db, {
      requestId: await insertRequest(db),
      sentAt: first,
      outcome: "verified",
    });

    expect(await readPracticeResetStanding(db)).toBe("practice");
  });

  dbTest(
    "reads an unmarked database whose writes were only ever recorded as one a reset may mark",
    async ({ database }) => {
      const { db } = database.connection;
      expect(await readPracticeResetStanding(db)).toBe("markable");

      const requestId = await insertRequest(db);
      await insertWrite(db, { requestId, sentAt: first, outcome: null, status: "recorded_only" });
      expect(await readPracticeResetStanding(db)).toBe("markable");
    }
  );

  dbTest.for(["sending", "answered", "failed"] as const)(
    "reads an unmarked database with a write that was %s as a real one",
    async (status, { database }) => {
      const { db } = database.connection;
      const requestId = await insertRequest(db);
      await insertWrite(db, { requestId, sentAt: first, outcome: null, status });

      expect(await readPracticeResetStanding(db)).toBe("real");
    }
  );
});

describe("resetPracticeDatabase", () => {
  dbTest(
    "empties the requests with their writes, events, snapshots and emails, unmatching their alerts",
    async ({ database }) => {
      const { db } = database.connection;
      await markEmptyDatabasePractice(db, first);
      const requestId = await insertRequest(db);
      await insertRequest(db, 2);
      await insertWrite(db, { requestId, sentAt: first, outcome: "verified" });
      await insertOutboxEmail(db, requestId);
      const signInEmail = await insertOutboxEmail(db, null);
      const alertId = await insertMatchedAlert(db, requestId);
      const expected = { requests: 2, writes: 1, emails: 1, alerts: 1 };

      expect(await countPracticeReset(db)).toEqual(expected);
      expect(await resetPracticeDatabase(db, { now: later, mark: false })).toEqual(expected);

      expect(await db.select().from(subRequests)).toEqual([]);
      expect(await db.select().from(espnWrites)).toEqual([]);
      expect(await db.select().from(subRequestEvents)).toEqual([]);
      expect(await db.select().from(subRequestSnapshots)).toEqual([]);
      expect((await db.select().from(emailOutbox)).map((row) => row.emailId)).toEqual([
        signInEmail,
      ]);
      const [alert] = await db.select().from(misuseAlerts).where(eq(misuseAlerts.alertId, alertId));
      expect(alert?.matchedRequestId).toBe(null);
      expect(await readPracticeSince(db)).toEqual(first);
    }
  );

  // A practice copy's after-season walk ends the season in its database; a reset undoes it.
  dbTest("clears a season's end recorded on a practice copy", async ({ database }) => {
    const { db } = database.connection;
    await markEmptyDatabasePractice(db, first);
    await recordSeasonEnd(db, { endedAt: first, final: { matchupPeriodId: 21, matchups: [] } });

    await resetPracticeDatabase(db, { now: later, mark: false });

    expect(await readSeasonEnd(db)).toBe(null);
    expect(await readPracticeSince(db)).toEqual(first);
  });

  dbTest("marks the database practice when asked to", async ({ database }) => {
    const { db } = database.connection;
    await insertRequest(db);

    await resetPracticeDatabase(db, { now: later, mark: true });

    expect(await readPracticeSince(db)).toEqual(later);
  });
});
