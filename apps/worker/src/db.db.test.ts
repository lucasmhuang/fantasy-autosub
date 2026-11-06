import { setTimeout as sleep } from "node:timers/promises";
import { createLogger } from "@injurysub/config";
import { afterEach, describe, expect, vi } from "vitest";
import { createWorkerDatabaseConnection } from "./db";
import { dbTest } from "./test-support";

afterEach(() => {
  vi.restoreAllMocks();
});

// The real worker logger, its lines captured instead of printed.
function captureWorkerLog() {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  return {
    logger: createLogger("worker", "debug"),
    events: (): Record<string, unknown>[] => printed.map((line) => JSON.parse(line)),
  };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

describe("createWorkerDatabaseConnection", () => {
  // Like the web's: the server cancels a statement past 7 s, so a stuck query can't hold a sweep.
  dbTest("has the server cancel a statement running past 7 s", async ({ database }) => {
    const connection = createWorkerDatabaseConnection(database.url, captureWorkerLog().logger);
    try {
      const { rows } = await connection.pool.query("show statement_timeout");

      expect(rows).toEqual([{ statement_timeout: "7s" }]);
    } finally {
      await connection.close();
    }
  });

  dbTest(
    "survives a dropped idle connection, logging it, and connects again",
    async ({ database }) => {
      const log = captureWorkerLog();
      const connection = createWorkerDatabaseConnection(database.url, log.logger);
      try {
        await connection.check();

        await database.connection.pool.query(
          "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'injurysub-worker' and datname = current_database()"
        );

        const logged = await waitFor(
          () => log.events().some((line) => line.event === "worker.db.connection_error"),
          2_000
        );
        expect(logged).toBe(true);
        await connection.check();
      } finally {
        await connection.close();
      }
    }
  );
});
