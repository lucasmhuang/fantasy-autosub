import { Client, Pool } from "pg";
import { afterEach, describe, expect, inject, it, test, vi } from "vitest";
import { createDbTest } from "./database";

// A raw pg connection, in the shape @injurysub/db's createDatabaseConnection returns.
function connectRaw(url: string) {
  const pool = new Pool({ connectionString: url, max: 2 });
  return { pool, close: () => pool.end() };
}

const dbTest = createDbTest({ test, inject }, connectRaw);
// For a pool that can't finish closing, so that teardown waits only briefly before the drop.
const impatientDbTest = createDbTest({ test, inject }, connectRaw, { closeTimeoutMs: 100 });
const unmigratedDbTest = createDbTest({ test, inject }, connectRaw, { migrated: false });

async function countAccounts(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "select count(*)::int as count from user_accounts"
  );
  return rows[0]?.count ?? -1;
}

// Invented people only. Every test that inserts uses the same address, so on a shared database a
// second insert would break the unique email.
async function insertInventedAccount(pool: Pool): Promise<void> {
  await pool.query(
    "insert into user_accounts (user_id, email, display_name, role) values (gen_random_uuid(), 'same.person@example.test', 'Invented Tester', 'manager')"
  );
}

async function databaseExists(name: string): Promise<boolean> {
  const client = new Client({ connectionString: inject("testDatabaseAdminUrl") });
  await client.connect();
  try {
    const { rows } = await client.query("select 1 from pg_database where datname = $1", [name]);
    return rows.length === 1;
  } finally {
    await client.end();
  }
}

describe("createDbTest", () => {
  const extraPools: Pool[] = [];
  const databaseNames: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  dbTest("gives each test an empty database the migrations built", async ({ database }) => {
    databaseNames.push(new URL(database.url).pathname.slice(1));

    expect(await countAccounts(database.connection.pool)).toBe(0);
    await insertInventedAccount(database.connection.pool);
    expect(await countAccounts(database.connection.pool)).toBe(1);
  });

  dbTest("keeps one test's rows from the next", async ({ database }) => {
    databaseNames.push(new URL(database.url).pathname.slice(1));

    await insertInventedAccount(database.connection.pool);

    expect(await countAccounts(database.connection.pool)).toBe(1);
  });

  dbTest("lets a test open more connections, and closes them for it", async ({ database }) => {
    const first = database.connect();
    const second = database.connect();
    extraPools.push(first.pool, second.pool);

    expect((await first.pool.query("select 1 as answer")).rows).toEqual([{ answer: 1 }]);
    expect((await second.pool.query("select 2 as answer")).rows).toEqual([{ answer: 2 }]);
  });

  dbTest("connects with TLS off whatever PGSSLMODE says", async ({ database }) => {
    vi.stubEnv("PGSSLMODE", "require");

    const extra = database.connect();

    expect((await extra.pool.query("select 1 as answer")).rows).toEqual([{ answer: 1 }]);
  });

  impatientDbTest(
    "drops its database even when a test leaves a client checked out",
    async ({ database }) => {
      databaseNames.push(new URL(database.url).pathname.slice(1));
      const client = await database.connection.pool.connect();

      // Never released, so its pool can't finish closing: the drop ends this connection, which pg
      // then reports as an error event on the client.
      await client.query("begin");
    }
  );

  unmigratedDbTest(
    "gives a test asking for no migrations an empty database, without the app's schema",
    async ({ database }) => {
      databaseNames.push(new URL(database.url).pathname.slice(1));

      const { rows } = await database.connection.pool.query(
        "select to_regclass('public.user_accounts') as accounts, to_regclass('drizzle.__drizzle_migrations') as migrations"
      );

      expect(rows).toEqual([{ accounts: null, migrations: null }]);
    }
  );

  dbTest("leaves alone a connection the test closed itself", async ({ database }) => {
    databaseNames.push(new URL(database.url).pathname.slice(1));

    await database.connection.close();

    expect(database.connection.pool.ended).toBe(true);
  });

  it("finds every earlier test's extra connections closed and its database dropped", async () => {
    expect(extraPools.map((pool) => pool.ended)).toEqual([true, true]);
    expect(databaseNames).toHaveLength(5);
    for (const name of databaseNames) {
      expect(await databaseExists(name)).toBe(false);
    }
  });
});
