import { setTimeout as sleep } from "node:timers/promises";
import type { DatabaseConnection } from "@injurysub/db";
import { describe, expect } from "vitest";
import { createWebDatabaseConnection } from "./db";
import { webDbTest } from "./test-support";

// Ends every backend that connections named `applicationName` hold in this test's database.
async function terminateBackends(connection: DatabaseConnection, applicationName: string) {
  await connection.pool.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1 and datname = current_database()",
    [applicationName]
  );
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

describe("createWebDatabaseConnection", () => {
  webDbTest(
    "survives a dropped idle connection, logging it, and connects again",
    async ({ database, webLog }) => {
      const connection = createWebDatabaseConnection(database.url);
      try {
        await connection.check();

        await terminateBackends(database.connection, "injurysub-web");

        const logged = await waitFor(
          () => webLog.events().some((line) => line.event === "web.db.connection_error"),
          2_000
        );
        expect(logged).toBe(true);
        await connection.check();
      } finally {
        await connection.close();
      }
    }
  );

  webDbTest("gives up on a query after 10 seconds", async ({ database }) => {
    const connection = createWebDatabaseConnection(database.url);
    try {
      // The monotonic clock: this machine's wall clock is stepped back about 2 s every 30 s.
      const started = performance.now();

      const failure = await connection.pool.query("select pg_sleep(12)").then(
        () => null,
        (error: unknown) => error
      );

      const elapsed = performance.now() - started;
      expect(failure).toMatchObject({ message: "Query read timeout" });
      expect(elapsed).toBeGreaterThan(9_500);
      expect(elapsed).toBeLessThan(11_500);
    } finally {
      await connection.close();
    }
  });
});
