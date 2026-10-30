import { setTimeout as sleep } from "node:timers/promises";
import { cutConnectionAt } from "@injurysub/test-db";
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
});
