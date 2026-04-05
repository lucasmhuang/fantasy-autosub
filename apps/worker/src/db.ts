import { loadServerEnv } from "@injurysub/config";
import { createDatabaseConnection, type DatabaseConnection } from "@injurysub/db";

export function createWorkerDatabaseConnection(): DatabaseConnection {
  const env = loadServerEnv();

  return createDatabaseConnection({
    connectionString: env.DATABASE_URL,
    applicationName: "injurysub-worker",
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    connectionTimeoutMs: 5_000,
  });
}
