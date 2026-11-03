import { setTimeout as sleep } from "node:timers/promises";
import { cutConnectionAt } from "@injurysub/test-db";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { createDatabaseConnection } from "./client";
import { dbTest } from "./test-support";

function ignoreLostConnection(): void {}

describe("createDatabaseConnection", () => {
  dbTest(
    "gives a transaction's client back when its connection is lost at begin, so close() still ends",
    async ({ database }) => {
      const proxy = await cutConnectionAt(database.url, "begin");
      const connection = createDatabaseConnection({
        connectionString: proxy.url,
        maxConnections: 1,
      });
      // pg reports the cut as an error event on the client too; unheard, it would crash the run.
      connection.pool.on("connect", (client) => {
        client.on("error", ignoreLostConnection);
      });
      try {
        await expect(connection.transaction(async () => "never reached")).rejects.toThrow();

        const closing = await Promise.race([
          connection.close().then(() => "closed"),
          sleep(3_000).then(() => "still waiting for its client"),
        ]);

        expect(closing).toBe("closed");
      } finally {
        await proxy.close();
      }
    }
  );

  dbTest("gives up on a query that runs longer than queryTimeoutMs", async ({ database }) => {
    const connection = createDatabaseConnection({
      connectionString: database.url,
      queryTimeoutMs: 200,
    });
    try {
      const started = performance.now();

      const failure = await connection.db.execute(sql`select pg_sleep(2)`).then(
        () => null,
        (error: unknown) => error
      );

      expect(messagesOf(failure)).toContain("Query read timeout");
      expect(performance.now() - started).toBeLessThan(1_500);
    } finally {
      await connection.close();
    }
  });
});

// The messages along an error's cause chain: drizzle wraps pg's error in its own.
function messagesOf(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}
