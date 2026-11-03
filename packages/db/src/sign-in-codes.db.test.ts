import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import { signInCodes, userAccounts } from "./schema";
import {
  expireSignInCode,
  findNewestSignInCode,
  insertSignInCode,
  listSignInCodeTimesSince,
  lockActiveUserAccount,
  markSignInCodeUsed,
  spendSignInCodeAttempt,
} from "./sign-in-codes";
import { dbTest } from "./test-support";

const now = new Date("2026-11-03T12:00:00.000Z");
const maxAttempts = 5;

function minutesFromNow(minutes: number) {
  return new Date(now.getTime() + minutes * 60_000);
}

// Invented people only.
async function insertInventedUser(
  db: DatabaseExecutor,
  overrides: Partial<typeof userAccounts.$inferInsert> = {}
) {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `person-${userId}@example.test`,
    displayName: "Invented Person",
    role: "manager",
    ...overrides,
  });
  return userId;
}

async function insertCode(
  db: DatabaseExecutor,
  userId: string,
  overrides: Partial<typeof signInCodes.$inferInsert> = {}
) {
  const codeId = randomUUID();
  await insertSignInCode(db, {
    codeId,
    userId,
    codeHash: "a-stored-hash",
    redirectPath: "/app",
    createdAt: now,
    expiresAt: minutesFromNow(10),
    ...overrides,
  });
  return codeId;
}

async function readCode(db: DatabaseExecutor, codeId: string) {
  const [row] = await db.select().from(signInCodes).where(eq(signInCodes.codeId, codeId));
  return row ?? null;
}

// The Postgres error under drizzle's wrapper, so a test can read its SQLSTATE.
async function causeOfRejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Error && error.cause !== undefined) return error.cause;
    throw error;
  }
  throw new Error("expected the database to refuse");
}

describe("spendSignInCodeAttempt", () => {
  dbTest("spends one try per call, up to five, then refuses", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db));

    const attempts: (number | null)[] = [];
    for (let call = 0; call < 6; call += 1) {
      const row = await spendSignInCodeAttempt(db, { codeId, now, maxAttempts });
      attempts.push(row?.attempts ?? null);
    }

    expect(attempts).toEqual([1, 2, 3, 4, 5, null]);
  });

  dbTest("refuses a try on a code whose expiry is now", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db), { expiresAt: now });

    expect(await spendSignInCodeAttempt(db, { codeId, now, maxAttempts })).toBeNull();
    expect((await readCode(db, codeId))?.attempts).toBe(0);
  });

  dbTest("refuses a try on a used code", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db), {
      usedAt: minutesFromNow(-1),
    });

    expect(await spendSignInCodeAttempt(db, { codeId, now, maxAttempts })).toBeNull();
  });

  dbTest("spends exactly five tries when ten arrive at once", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db));

    const results = await Promise.all(
      Array.from({ length: 10 }, () => spendSignInCodeAttempt(db, { codeId, now, maxAttempts }))
    );

    expect(results.filter((row) => row !== null)).toHaveLength(5);
    expect((await readCode(db, codeId))?.attempts).toBe(5);
  });
});

describe("markSignInCodeUsed", () => {
  dbTest("marks a code used once, and refuses a second call", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db));

    expect((await markSignInCodeUsed(db, { codeId, now }))?.usedAt).toEqual(now);
    expect(await markSignInCodeUsed(db, { codeId, now: minutesFromNow(1) })).toBeNull();
  });

  dbTest("lets only one of two simultaneous calls mark a code used", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db));

    const results = await Promise.all([
      markSignInCodeUsed(db, { codeId, now }),
      markSignInCodeUsed(db, { codeId, now }),
    ]);

    expect(results.filter((row) => row !== null)).toHaveLength(1);
  });
});

describe("findNewestSignInCode", () => {
  dbTest("finds the user's newest code, ignoring other users' codes", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db);
    const otherUserId = await insertInventedUser(db);
    await insertCode(db, userId, { createdAt: minutesFromNow(-10) });
    const newest = await insertCode(db, userId, { createdAt: minutesFromNow(-1) });
    await insertCode(db, userId, { createdAt: minutesFromNow(-5) });
    await insertCode(db, otherUserId, { createdAt: now });

    expect((await findNewestSignInCode(db, userId))?.codeId).toBe(newest);
    expect(await findNewestSignInCode(db, await insertInventedUser(db))).toBeNull();
  });
});

describe("listSignInCodeTimesSince", () => {
  dbTest("lists only this user's codes sent after the given time", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db);
    const otherUserId = await insertInventedUser(db);
    for (const minutes of [-20, -15, -10, -1]) {
      await insertCode(db, userId, { createdAt: minutesFromNow(minutes) });
    }
    await insertCode(db, otherUserId, { createdAt: minutesFromNow(-5) });

    expect(await listSignInCodeTimesSince(db, userId, minutesFromNow(-15))).toEqual([
      minutesFromNow(-10),
      minutesFromNow(-1),
    ]);
  });
});

describe("expireSignInCode", () => {
  dbTest("makes a code refuse its next try", async ({ database }) => {
    const { db } = database.connection;
    const codeId = await insertCode(db, await insertInventedUser(db));

    await expireSignInCode(db, { codeId, now });

    expect(await spendSignInCodeAttempt(db, { codeId, now, maxAttempts })).toBeNull();
  });
});

describe("lockActiveUserAccount", () => {
  dbTest("locks an active user, and not a disabled or unknown one", async ({ database }) => {
    const { connection } = database;
    const active = await insertInventedUser(connection.db);
    const disabled = await insertInventedUser(connection.db, { isActive: false });

    await connection.transaction(async (tx) => {
      expect(await lockActiveUserAccount(tx, active)).toBe(true);
      expect(await lockActiveUserAccount(tx, disabled)).toBe(false);
      expect(await lockActiveUserAccount(tx, randomUUID())).toBe(false);
    });
  });

  dbTest(
    "makes a second lock on the same user wait until the first commits, but not another user's",
    async ({ database }) => {
      const { connection } = database;
      const userId = await insertInventedUser(connection.db);
      const otherUserId = await insertInventedUser(connection.db);
      const other = database.connect();

      await connection.transaction(async (tx) => {
        await lockActiveUserAccount(tx, userId);

        const refusal = await causeOfRejection(
          other.transaction(async (otherTx) => {
            await otherTx.execute(sql`set local lock_timeout = '200ms'`);
            await lockActiveUserAccount(otherTx, userId);
          })
        );
        expect(refusal).toMatchObject({ code: "55P03" });

        const otherUserLocked = await other.transaction(async (otherTx) => {
          await otherTx.execute(sql`set local lock_timeout = '200ms'`);
          return lockActiveUserAccount(otherTx, otherUserId);
        });
        expect(otherUserLocked).toBe(true);
      });

      const lockedAfterCommit = await other.transaction((otherTx) =>
        lockActiveUserAccount(otherTx, userId)
      );
      expect(lockedAfterCommit).toBe(true);
    }
  );
});

describe("sign_in_codes", () => {
  dbTest("deletes a user's codes with the user", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db);
    const codeId = await insertCode(db, userId);

    await db.delete(userAccounts).where(eq(userAccounts.userId, userId));

    expect(await readCode(db, codeId)).toBeNull();
  });
});
