import { loadServerEnv } from "@injurysub/config";
import { createDatabaseConnection, type DatabaseConnection } from "@injurysub/db";

declare global {
  var __injurysubWebDb: DatabaseConnection | undefined;
}

export function getWebDatabaseConnection(): DatabaseConnection {
  if (globalThis.__injurysubWebDb) {
    return globalThis.__injurysubWebDb;
  }

  const env = loadServerEnv();
  const connection = createDatabaseConnection({
    connectionString: env.DATABASE_URL,
    applicationName: "injurysub-web",
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
  });

  globalThis.__injurysubWebDb = connection;

  return connection;
}
