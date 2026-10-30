import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DatabaseClient = NodePgDatabase<typeof schema>;

// A transaction from DatabaseClient.transaction, which isn't a NodePgDatabase but runs the same
// queries; and either one, for queries that must also run inside another's transaction.
export type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
export type DatabaseExecutor = DatabaseClient | DatabaseTransaction;

export type DatabaseConnection = {
  db: DatabaseClient;
  pool: Pool;
  check: () => Promise<void>;
  close: () => Promise<void>;
};

export type CreateDatabaseConnectionOptions = {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
};

export function createDatabaseConnection(
  options: CreateDatabaseConnectionOptions
): DatabaseConnection {
  const pool = new Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.maxConnections,
    idleTimeoutMillis: options.idleTimeoutMs,
    connectionTimeoutMillis: options.connectionTimeoutMs,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async check() {
      await db.execute(sql`select 1`);
    },
    async close() {
      await pool.end();
    },
  };
}
