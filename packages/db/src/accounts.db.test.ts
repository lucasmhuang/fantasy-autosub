import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseClient } from "./client";
import { userAccounts } from "./schema";
import { dbTest } from "./test-support";

type NewAccount = typeof userAccounts.$inferInsert;

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

// The Postgres error under drizzle's wrapper, so a test can read its SQLSTATE and constraint.
async function refusalOf(db: DatabaseClient, account: NewAccount): Promise<unknown> {
  try {
    await db.insert(userAccounts).values(account);
  } catch (error) {
    if (error instanceof Error && error.cause !== undefined) return error.cause;
    throw error;
  }
  throw new Error("expected the insert to be refused");
}

describe("user_accounts", () => {
  dbTest("refuses a second active account for one team", async ({ database }) => {
    const { db } = database.connection;
    await db.insert(userAccounts).values(inventedAccount({ teamId: 4 }));

    expect(await refusalOf(db, inventedAccount({ teamId: 4 }))).toMatchObject({
      code: "23505",
      constraint: "user_accounts_active_team_unique",
    });
  });

  dbTest("refuses a second active commissioner", async ({ database }) => {
    const { db } = database.connection;
    await db.insert(userAccounts).values(inventedAccount({ teamId: 1, role: "commissioner" }));

    expect(await refusalOf(db, inventedAccount({ teamId: 7, role: "commissioner" }))).toMatchObject(
      {
        code: "23505",
        constraint: "user_accounts_active_commissioner_unique",
      }
    );
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
