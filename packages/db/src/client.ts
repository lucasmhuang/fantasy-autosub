import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { DatabaseError } from "./errors";
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
  // Runs `work` in one transaction; use it rather than db.transaction. drizzle's transaction on a
  // pool checks a client out and sends `begin` before the `try` that gives it back, so a connection
  // lost at `begin` would keep the client, and close() would never finish.
  transaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export type CreateDatabaseConnectionOptions = {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  queryTimeoutMs?: number;
  // The server cancels a statement running longer than this (Postgres's statement_timeout). Set it
  // below queryTimeoutMs, so the server ends a slow statement before this side gives up on it.
  statementTimeoutMs?: number;
  // TCP keepalive on each connection, with the system's default timing (about 2 hours before the
  // first probe on Linux).
  keepAlive?: boolean;
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
    // Fails the call on this side only: the server still finishes the statement.
    query_timeout: options.queryTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    keepAlive: options.keepAlive,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async check() {
      await db.execute(sql`select 1`);
    },
    transaction: (work) => runTransaction(pool, work),
    async close() {
      await pool.end();
    },
  };
}

async function runTransaction<T>(
  pool: Pool,
  work: (tx: DatabaseTransaction) => Promise<T>
): Promise<T> {
  const client = await connectForTransaction(pool);
  let succeeded = false;
  try {
    const result = await drizzle(client, { schema }).transaction(work);
    succeeded = true;
    return result;
  } finally {
    // A failed transaction's client is dropped, never reused: its rollback may not have run (a
    // query past query_timeout leaves its statement going, and the rollback queues behind it), so
    // it could still be inside the transaction. pg-pool also drops a lost connection.
    client.release(!succeeded);
  }
}

// A connection the pool can't open fails before any query, so drizzle never wraps it: it becomes a
// DatabaseError, which callers answer and log like a failed query.
async function connectForTransaction(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new DatabaseError("connect_failed", "Couldn't open a connection for a transaction.", {
      cause: error,
    });
  }
}
