import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import {
  claimPendingEmails,
  enqueueEmail,
  markEmailFailed,
  markEmailSent,
  type NewOutboxEmail,
} from "./outbox";
import { emailOutbox, userAccounts } from "./schema";
import { markProvingDone, readLeagueSettings, writeLeagueSettings } from "./settings";
import { dbTest } from "./test-support";

const now = new Date("2026-11-05T20:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

function email(overrides: Partial<NewOutboxEmail> = {}): NewOutboxEmail {
  return {
    emailId: randomUUID(),
    dedupeKey: `${randomUUID()}:0`,
    toAddress: "commissioner@example.test",
    subject: "Team 5 needs you",
    body: "Body",
    createdAt: now,
    ...overrides,
  };
}

// A claim made `minutes` from now that lapses after 10 minutes, at most three tries.
function claimAt(minutes: number) {
  return {
    now: minutesFromNow(minutes),
    claimLapsedBefore: minutesFromNow(minutes - 10),
    maxAttempts: 3,
    limit: 10,
  };
}

async function insertCommissioner(db: DatabaseExecutor): Promise<string> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `person-${userId}@example.test`,
    teamId: 1,
    displayName: "Invented Person",
    role: "commissioner",
  });
  return userId;
}

describe("readLeagueSettings", () => {
  dbTest(
    "gives approval-required and an empty allowlist before anything is saved",
    async ({ database }) => {
      expect(await readLeagueSettings(database.connection.db)).toEqual({
        executionMode: "approval_required",
        writeAllowlist: [],
        allowlistBeforeOff: null,
        provingDoneAt: null,
        updatedBy: null,
        updatedAt: null,
      });
    }
  );

  dbTest("reads back what was saved, and a second save replaces it", async ({ database }) => {
    const { db } = database.connection;
    const userId = randomUUID();
    await db.insert(userAccounts).values({
      userId,
      email: `person-${userId}@example.test`,
      teamId: 1,
      displayName: "Invented Person",
      role: "commissioner",
    });

    const first = await writeLeagueSettings(db, {
      executionMode: "auto",
      writeAllowlist: [1],
      updatedBy: userId,
      now,
      shownUpdatedAt: null,
    });
    const second = await writeLeagueSettings(db, {
      executionMode: "auto",
      writeAllowlist: [],
      updatedBy: userId,
      now: minutesFromNow(1),
      shownUpdatedAt: now,
    });

    expect([first, second]).toEqual([true, true]);
    expect(await readLeagueSettings(db)).toEqual({
      executionMode: "auto",
      writeAllowlist: [],
      allowlistBeforeOff: null,
      provingDoneAt: null,
      updatedBy: userId,
      updatedAt: minutesFromNow(1),
    });
  });

  // S9: proving is marked done once; the date stays, and the settings around it are untouched.
  dbTest("marks proving done before any settings were saved", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertCommissioner(db);

    await markProvingDone(db, { updatedBy: userId, now });

    expect(await readLeagueSettings(db)).toEqual({
      executionMode: "approval_required",
      writeAllowlist: [],
      allowlistBeforeOff: null,
      provingDoneAt: now,
      updatedBy: userId,
      updatedAt: now,
    });
  });

  dbTest(
    "marks proving done once, leaving the mode, the allowlist and when they were saved",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertCommissioner(db);
      const saved = { executionMode: "auto" as const, writeAllowlist: [1], updatedBy: userId };
      await writeLeagueSettings(db, { ...saved, now, shownUpdatedAt: null });

      await markProvingDone(db, { updatedBy: userId, now: minutesFromNow(1) });
      await markProvingDone(db, { updatedBy: userId, now: minutesFromNow(2) });

      expect(await readLeagueSettings(db)).toEqual({
        executionMode: "auto",
        writeAllowlist: [1],
        allowlistBeforeOff: null,
        provingDoneAt: minutesFromNow(1),
        updatedBy: userId,
        updatedAt: now,
      });
    }
  );

  dbTest("keeps the proving-done date through a later settings save", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertCommissioner(db);
    await markProvingDone(db, { updatedBy: userId, now });

    const written = await writeLeagueSettings(db, {
      executionMode: "auto",
      writeAllowlist: [1, 2],
      updatedBy: userId,
      now: minutesFromNow(5),
      shownUpdatedAt: now,
    });

    expect(written).toBe(true);
    expect(await readLeagueSettings(db)).toMatchObject({
      writeAllowlist: [1, 2],
      allowlistBeforeOff: null,
      provingDoneAt: now,
    });
  });

  // Q2, O11: a tab showing older settings can't silently undo a later change (automation off).
  dbTest("refuses a save over settings changed since they were shown", async ({ database }) => {
    const { db } = database.connection;
    const userId = randomUUID();
    await db.insert(userAccounts).values({
      userId,
      email: `person-${userId}@example.test`,
      teamId: 1,
      displayName: "Invented Person",
      role: "commissioner",
    });
    const save = (writeAllowlist: number[], at: Date, shownUpdatedAt: Date | null) =>
      writeLeagueSettings(db, {
        executionMode: "auto",
        writeAllowlist,
        updatedBy: userId,
        now: at,
        shownUpdatedAt,
      });
    await save([1], now, null);
    await save([], minutesFromNow(1), now);

    const staleUpdate = await save([1], minutesFromNow(2), now);
    const staleFirst = await save([1], minutesFromNow(2), null);

    expect([staleUpdate, staleFirst]).toEqual([false, false]);
    expect(await readLeagueSettings(db)).toMatchObject({
      writeAllowlist: [],
      updatedAt: minutesFromNow(1),
    });
  });
});

describe("enqueueEmail", () => {
  dbTest("queues an email once per dedupe key", async ({ database }) => {
    const { db } = database.connection;
    const dedupeKey = "request-1:2";

    expect(await enqueueEmail(db, email({ dedupeKey }))).toBe(true);
    expect(await enqueueEmail(db, email({ dedupeKey }))).toBe(false);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });
});

describe("claimPendingEmails", () => {
  dbTest("never gives two simultaneous claimers the same email", async ({ database }) => {
    const { db } = database.connection;
    for (let index = 0; index < 4; index += 1) await enqueueEmail(db, email());

    const [first, second] = await Promise.all([
      claimPendingEmails(db, claimAt(0)),
      claimPendingEmails(db, claimAt(0)),
    ]);

    const claimed = [...first!, ...second!].map((row) => row.emailId);
    expect(claimed).toHaveLength(4);
    expect(new Set(claimed).size).toBe(4);
  });

  dbTest(
    "leaves a claimed email alone until its claim lapses, counting each claim",
    async ({ database }) => {
      const { db } = database.connection;
      await enqueueEmail(db, email());

      expect((await claimPendingEmails(db, claimAt(0))).map((row) => row.attempts)).toEqual([1]);
      expect(await claimPendingEmails(db, claimAt(5))).toEqual([]);
      expect((await claimPendingEmails(db, claimAt(11))).map((row) => row.attempts)).toEqual([2]);
    }
  );

  dbTest("never retakes an email that has used its three attempts", async ({ database }) => {
    const { db } = database.connection;
    await enqueueEmail(db, email());
    for (const minutes of [0, 11, 22]) await claimPendingEmails(db, claimAt(minutes));

    expect(await claimPendingEmails(db, claimAt(33))).toEqual([]);
  });

  dbTest("never claims an email already sent or failed", async ({ database }) => {
    const { db } = database.connection;
    const sent = email();
    const failed = email();
    await enqueueEmail(db, sent);
    await enqueueEmail(db, failed);
    await markEmailSent(db, { emailId: sent.emailId, now });
    await markEmailFailed(db, { emailId: failed.emailId, now, failureCode: "send_rejected" });

    expect(await claimPendingEmails(db, claimAt(0))).toEqual([]);
    const rows = await db.select().from(emailOutbox);
    expect(rows.find((row) => row.emailId === failed.emailId)?.failureCode).toBe("send_rejected");
  });
});
