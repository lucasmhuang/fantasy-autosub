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

  // pg's query timeout leaves the statement running, and drizzle's rollback queues behind it and
  // times out too. A client handed back then would still be inside the transaction.
  dbTest(
    "never hands back a failed transaction's client, so a later query can't run inside it",
    async ({ database }) => {
      await database.connection.pool.query("create table probe_rows (id int primary key)");
      await database.connection.pool.query("insert into probe_rows values (1)");
      const connection = createDatabaseConnection({
        connectionString: database.url,
        maxConnections: 1,
        queryTimeoutMs: 200,
      });
      connection.pool.on("error", ignoreLostConnection);
      connection.pool.on("connect", (client) => {
        client.on("error", ignoreLostConnection);
      });
      const holder = await database.connection.pool.connect();
      try {
        await holder.query("begin");
        await holder.query("select * from probe_rows where id = 1 for update");

        await expect(
          connection.transaction((tx) =>
            tx.execute(sql`select * from probe_rows where id = 1 for update`)
          )
        ).rejects.toThrow();
        await holder.query("commit");
        await sleep(200);

        const state = await connection.pool.query(
          "select xact_start < query_start as inside_old_transaction from pg_stat_activity where pid = pg_backend_pid()"
        );
        expect(state.rows[0]).toEqual({ inside_old_transaction: false });
      } finally {
        holder.release();
        await connection.close();
      }
    }
  );
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
