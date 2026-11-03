import type { Logger } from "@injurysub/config";
import { createDatabaseConnection, type DatabaseConnection } from "@injurysub/db";

// pg reports a dropped connection as an error event on the client, and for an idle client on
// the pool too. Unheard, the event would crash the worker. Each drop is logged once, from the
// client; the pool discards that client and opens a new one for the next query.
export function createWorkerDatabaseConnection(url: string, logger: Logger): DatabaseConnection {
  const connection = createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-worker",
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
  });
  connection.pool.on("error", ignoreLoggedError);
  connection.pool.on("connect", (client) => {
    client.on("error", (error) => {
      logger.error("worker.db.connection_error", error);
    });
  });
  return connection;
}

function ignoreLoggedError(): void {}
