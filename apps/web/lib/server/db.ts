import { loadServerEnv } from "@injurysub/config";
import { createDatabaseConnection, type DatabaseConnection } from "@injurysub/db";
import { getWebLogger } from "./logger";

declare global {
  var __injurysubWebDb: DatabaseConnection | undefined;
}

// pg reports a dropped connection as an error event on the client, and for an idle client on
// the pool too. Unheard, the event would crash the server. Each drop is logged once, from the
// client; the pool discards that client and opens a new one for the next query.
export function createWebDatabaseConnection(url: string): DatabaseConnection {
  const connection = createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-web",
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
    // The server cancels a slow statement at 7 s; this side gives up at 10 s if it stops answering.
    // The server times its cancel by the wall clock, so the 3 s gap also absorbs a clock step.
    statementTimeoutMs: 7_000,
    queryTimeoutMs: 10_000,
    keepAlive: true,
  });
  connection.pool.on("error", ignoreLoggedError);
  connection.pool.on("connect", (client) => {
    client.on("error", (error) => {
      getWebLogger().error("web.db.connection_error", error);
    });
  });
  return connection;
}

function ignoreLoggedError(): void {}

export function getWebDatabaseConnection(): DatabaseConnection {
  if (globalThis.__injurysubWebDb) {
    return globalThis.__injurysubWebDb;
  }

  const connection = createWebDatabaseConnection(loadServerEnv().DATABASE_URL);

  globalThis.__injurysubWebDb = connection;

  return connection;
}
