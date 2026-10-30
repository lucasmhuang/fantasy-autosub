import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import type { inject as vitestInject, test as vitestTest } from "vitest";
import { urlOfDatabase, withClient } from "./connection";
import { TestDatabaseError } from "./errors";
import { TEMPLATE_DATABASE } from "./global-setup";

// A connection the fixture can watch and close: what @injurysub/db's createDatabaseConnection
// returns, or anything shaped like it.
export type ClosableConnection = { pool: Pool; close: () => Promise<void> };

// What a database test gets: the URL of its own database, a connection to it built by the
// package's `connect`, and `connect()` for more (two clients at once). The fixture closes every
// one of them, then drops the database.
export type TestDatabase<Connection> = {
  url: string;
  connection: Connection;
  connect: () => Connection;
};

export function resolveAdminUrl(value: string | undefined): string {
  if (value !== undefined) return value;
  throw new TestDatabaseError(
    "not_a_database_test",
    "Only database tests get a test database. Name the test file *.db.test.ts (or *.db.test.tsx), so that it runs in the db project, whose setup starts the server."
  );
}

// The `test` for a package's database tests, each with a fresh database cloned from the migrated
// template. The caller passes in Vitest's own `test` and `inject`: this package imports nothing
// from Vitest at run time, since the root global setup loads it too, and Vitest refuses there.
// `closeTimeoutMs` is how long teardown waits for each connection to close before the drop, and
// `migrated: false` gives each test an empty database instead, for code that must refuse one.
export function createDbTest<Connection extends ClosableConnection>(
  vitest: { test: typeof vitestTest; inject: typeof vitestInject },
  connect: (url: string) => Connection,
  { closeTimeoutMs = 5_000, migrated = true }: { closeTimeoutMs?: number; migrated?: boolean } = {}
) {
  return vitest.test.extend<{ database: TestDatabase<Connection> }>({
    database: async ({}, use) => {
      const adminUrl = resolveAdminUrl(vitest.inject("testDatabaseAdminUrl"));
      const name = await cloneDatabase(adminUrl, migrated ? TEMPLATE_DATABASE : "template0");
      const url = urlOfDatabase(adminUrl, name);
      const opened: Connection[] = [];
      const open = () => {
        const connection = connect(url);
        watch(connection.pool);
        opened.push(connection);
        return connection;
      };
      try {
        await use({ url, connection: open(), connect: open });
      } finally {
        await closeThenDrop(opened, { adminUrl, name, closeTimeoutMs });
      }
    },
  });
}

// template0 is Postgres's own empty database.
async function cloneDatabase(adminUrl: string, template: string): Promise<string> {
  const name = `test_${randomBytes(4).toString("hex")}`;
  await withClient(
    adminUrl,
    (client) => client.query(`create database ${name} template ${template}`),
    { timeoutMs: 10_000 }
  );
  return name;
}

// pg-pool takes its own error listener off a client while a test holds it, and pg then reports a
// lost connection as an error event on that client, which crashes the run when nothing listens.
// A lost connection reaches the test as its query's failure; at teardown, the drop ends whatever
// is still open on purpose.
function watch(pool: Pool): void {
  pool.on("error", ignoreLostConnection);
  pool.on("connect", (client: PoolClient) => {
    client.on("error", ignoreLostConnection);
  });
}

function ignoreLostConnection(): void {}

// Closes each connection the test opened, then drops its database. Vitest sets no time limit on a
// fixture's teardown, and a pool whose client a test still holds never finishes closing, so each
// close has a time limit; the drop ends anything still open. A failed close is thrown after the
// drop. A connection the test closed itself is left alone, since a second close fails.
async function closeThenDrop(
  opened: ClosableConnection[],
  { adminUrl, name, closeTimeoutMs }: { adminUrl: string; name: string; closeTimeoutMs: number }
): Promise<void> {
  const closeWithinLimit = (connection: ClosableConnection) =>
    Promise.race([connection.close(), sleep(closeTimeoutMs, undefined, { ref: false })]);
  const closing = await Promise.allSettled(
    opened.filter((connection) => !connection.pool.ending).map(closeWithinLimit)
  );
  await withClient(adminUrl, (client) => client.query(`drop database ${name} with (force)`), {
    timeoutMs: 10_000,
  });
  const failedClose = closing.find((result) => result.status === "rejected");
  if (failedClose) throw failedClose.reason;
}
