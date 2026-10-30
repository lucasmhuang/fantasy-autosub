import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { readMigrationState } from "./migration-state";
import { dbTest } from "./test-support";

// Read here on its own, so the expected values don't come from the code under test.
const journal: { entries: { when: number }[] } = JSON.parse(
  readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")
);
const known = journal.entries.map((entry) => entry.when).sort((a, b) => a - b);
const newest = known.at(-1) ?? 0;
const secondNewest = known.at(-2) ?? null;

describe("readMigrationState", () => {
  dbTest(
    "finds a migrated database level with this checkout's migrations",
    async ({ database }) => {
      expect(await readMigrationState(database.connection.db)).toEqual({
        hasAccountsTable: true,
        latestApplied: newest,
        latestKnown: newest,
      });
    }
  );

  dbTest("finds a database missing its newest migration behind", async ({ database }) => {
    const { db } = database.connection;
    await db.execute(
      sql`delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`
    );

    expect(await readMigrationState(db)).toMatchObject({
      latestApplied: secondNewest,
      latestKnown: newest,
    });
  });

  dbTest("finds a database migrated by a newer checkout ahead", async ({ database }) => {
    const { db } = database.connection;
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('from-a-newer-checkout', ${newest + 1_000})`
    );

    expect(await readMigrationState(db)).toMatchObject({
      latestApplied: newest + 1_000,
      latestKnown: newest,
    });
  });

  dbTest("finds nothing applied in a database without the app's schema", async ({ database }) => {
    const { db } = database.connection;
    await db.execute(sql`drop schema drizzle cascade`);
    await db.execute(sql`drop table user_accounts cascade`);

    expect(await readMigrationState(db)).toEqual({
      hasAccountsTable: false,
      latestApplied: null,
      latestKnown: newest,
    });
  });
});
