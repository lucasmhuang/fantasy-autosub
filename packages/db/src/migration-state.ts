import { sql } from "drizzle-orm";
import migrationJournal from "../drizzle/meta/_journal.json";
import type { DatabaseExecutor } from "./client";

export type MigrationState = {
  hasAccountsTable: boolean;
  latestApplied: number | null;
  latestKnown: number;
};

// Where a database stands against this checkout's migrations. drizzle records each applied
// migration with its journal entry's `when` as created_at, so the newest on each side compare
// directly: behind means the database needs this checkout's migrations, and ahead means a newer
// checkout migrated it. With no drizzle schema, nothing is applied.
export async function readMigrationState(db: DatabaseExecutor): Promise<MigrationState> {
  const latestKnown = Math.max(...migrationJournal.entries.map((entry) => entry.when));
  const { rows } = await db.execute<{ accounts: string | null; migrations: string | null }>(
    sql`select to_regclass('public.user_accounts') as accounts, to_regclass('drizzle.__drizzle_migrations') as migrations`
  );
  const hasAccountsTable = rows[0]?.accounts != null;
  if (rows[0]?.migrations == null) return { hasAccountsTable, latestApplied: null, latestKnown };
  const applied = await db.execute<{ latest: string | null }>(
    sql`select max(created_at)::text as latest from drizzle.__drizzle_migrations`
  );
  const latest = applied.rows[0]?.latest;
  return { hasAccountsTable, latestApplied: latest == null ? null : Number(latest), latestKnown };
}
