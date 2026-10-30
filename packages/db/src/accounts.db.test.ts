import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import {
  deactivateAllUserAccounts,
  listUserAccounts,
  lockUserAccountsForSync,
  revokeSessionsForUsers,
  upsertUserAccountByEmail,
} from "./accounts";
import { createSession, findActiveUserAccountByEmail } from "./auth";
import type { DatabaseClient } from "./client";
import { sessions, userAccounts } from "./schema";
import { dbTest } from "./test-support";

type NewAccount = typeof userAccounts.$inferInsert;
type SyncedAccount = Parameters<typeof upsertUserAccountByEmail>[1];

// Invented people only.
function inventedAccount(overrides: Partial<NewAccount>): NewAccount {
  const userId = randomUUID();
  return {
    userId,
    email: `person-${userId}@example.test`,
    teamId: null,
    displayName: "Invented Person",
    role: "manager",
    isActive: true,
    ...overrides,
  };
}

function asSynced(account: NewAccount, overrides: Partial<SyncedAccount> = {}): SyncedAccount {
  return {
    userId: randomUUID(),
    email: account.email,
    teamId: account.teamId ?? null,
    displayName: account.displayName,
    role: account.role,
    ...overrides,
  };
}

// The Postgres error under drizzle's wrapper, so a test can read its SQLSTATE and constraint.
async function causeOfRejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Error && error.cause !== undefined) return error.cause;
    throw error;
  }
  throw new Error("expected the database to refuse");
}

async function activeByUser(db: DatabaseClient): Promise<Record<string, boolean>> {
  const accounts = await listUserAccounts(db);
  return Object.fromEntries(accounts.map((account) => [account.userId, account.isActive]));
}

async function revokedAtBySession(db: DatabaseClient): Promise<Record<string, Date | null>> {
  const rows = await db.select().from(sessions);
  return Object.fromEntries(rows.map((row) => [row.sessionId, row.revokedAt]));
}

describe("user_accounts", () => {
  dbTest("refuses a second active account for one team", async ({ database }) => {
    const { db } = database.connection;
    await db.insert(userAccounts).values(inventedAccount({ teamId: 4 }));

    const refusal = await causeOfRejection(
      db.insert(userAccounts).values(inventedAccount({ teamId: 4 }))
    );

    expect(refusal).toMatchObject({
      code: "23505",
      constraint: "user_accounts_active_team_unique",
    });
  });

  dbTest("refuses a second active commissioner", async ({ database }) => {
    const { db } = database.connection;
    await db.insert(userAccounts).values(inventedAccount({ teamId: 1, role: "commissioner" }));

    const refusal = await causeOfRejection(
      db.insert(userAccounts).values(inventedAccount({ teamId: 7, role: "commissioner" }))
    );

    expect(refusal).toMatchObject({
      code: "23505",
      constraint: "user_accounts_active_commissioner_unique",
    });
  });

  dbTest("accepts an inactive account on an active account's team", async ({ database }) => {
    const { db } = database.connection;
    await db.insert(userAccounts).values(inventedAccount({ teamId: 5 }));

    await db.insert(userAccounts).values(inventedAccount({ teamId: 5, isActive: false }));
    await db
      .insert(userAccounts)
      .values(inventedAccount({ teamId: 6, role: "commissioner", isActive: false }));
    await db.insert(userAccounts).values(inventedAccount({ teamId: 1, role: "commissioner" }));

    expect(await db.$count(userAccounts)).toBe(4);
  });
});

describe("account sync queries", () => {
  dbTest(
    "upserts by email: inserts, then updates that email's account in place",
    async ({ database }) => {
      const { db } = database.connection;
      const first = asSynced(inventedAccount({ teamId: 2 }));

      await upsertUserAccountByEmail(db, first);
      await upsertUserAccountByEmail(db, {
        ...first,
        userId: randomUUID(),
        teamId: 3,
        displayName: "Invented Person Renamed",
      });

      expect(await listUserAccounts(db)).toEqual([
        expect.objectContaining({
          userId: first.userId,
          email: first.email,
          teamId: 3,
          displayName: "Invented Person Renamed",
          isActive: true,
        }),
      ]);
    }
  );

  dbTest(
    "reactivates the listed account and leaves the other disabled, in one transaction",
    async ({ database }) => {
      const { db } = database.connection;
      const listed = inventedAccount({ teamId: 1, isActive: false });
      const unlisted = inventedAccount({ teamId: 2 });
      await db.insert(userAccounts).values([listed, unlisted]);

      await db.transaction(async (tx) => {
        await lockUserAccountsForSync(tx);
        await deactivateAllUserAccounts(tx);
        await upsertUserAccountByEmail(tx, asSynced(listed));
      });

      expect(await activeByUser(db)).toEqual({ [listed.userId]: true, [unlisted.userId]: false });
    }
  );

  dbTest("revokes only the listed users' open sessions", async ({ database }) => {
    const { db } = database.connection;
    const revoked = inventedAccount({ teamId: 1 });
    const kept = inventedAccount({ teamId: 2 });
    await db.insert(userAccounts).values([revoked, kept]);
    const expiresAt = new Date("2027-01-01T00:00:00Z");
    const earlier = new Date("2026-10-01T12:00:00Z");
    const now = new Date("2026-10-30T12:00:00Z");
    await createSession(db, { sessionId: "open", userId: revoked.userId, expiresAt });
    await createSession(db, {
      sessionId: "ended-earlier",
      userId: revoked.userId,
      expiresAt,
      revokedAt: earlier,
    });
    await createSession(db, { sessionId: "other-user", userId: kept.userId, expiresAt });

    await revokeSessionsForUsers(db, [revoked.userId], now);

    expect(await revokedAtBySession(db)).toEqual({
      open: now,
      "ended-earlier": earlier,
      "other-user": null,
    });
  });

  dbTest("rolls the whole sync back when one of its statements fails", async ({ database }) => {
    const { db } = database.connection;
    const first = inventedAccount({ teamId: 1 });
    const second = inventedAccount({ teamId: 2 });
    await db.insert(userAccounts).values([first, second]);

    const refusal = await causeOfRejection(
      db.transaction(async (tx) => {
        await lockUserAccountsForSync(tx);
        await deactivateAllUserAccounts(tx);
        await upsertUserAccountByEmail(tx, asSynced(first));
        await upsertUserAccountByEmail(tx, asSynced(inventedAccount({ teamId: 1 })));
      })
    );

    expect(refusal).toMatchObject({ code: "23505" });
    expect(await activeByUser(db)).toEqual({ [first.userId]: true, [second.userId]: true });
  });

  dbTest("makes another writer wait, until its own lock_timeout gives up", async ({ database }) => {
    await database.connection.db.transaction(async (tx) => {
      await lockUserAccountsForSync(tx);
      const other = database.connect();
      const started = Date.now();

      const refusal = await causeOfRejection(
        other.db.transaction(async (otherTx) => {
          await otherTx.execute(sql`set local lock_timeout = '200ms'`);
          await otherTx.insert(userAccounts).values(inventedAccount({ teamId: 3 }));
        })
      );

      expect(refusal).toMatchObject({ code: "55P03" });
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });

  dbTest(
    "lets sign-in read the accounts as they were while a sync holds the lock",
    async ({ database }) => {
      const account = inventedAccount({ teamId: 4 });
      await database.connection.db.insert(userAccounts).values(account);

      await database.connection.db.transaction(async (tx) => {
        await lockUserAccountsForSync(tx);
        await deactivateAllUserAccounts(tx);
        const reader = database.connect();

        const found = await Promise.race([
          findActiveUserAccountByEmail(reader.db, account.email),
          sleep(2_000).then(() => "the read waited for the sync's lock"),
        ]);

        expect(found).toMatchObject({ userId: account.userId, isActive: true });
      });
    }
  );
});
