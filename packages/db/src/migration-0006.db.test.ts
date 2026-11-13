import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { afterEach, describe, expect } from "vitest";
import { unmigratedDbTest } from "./test-support";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const SCAFFOLD_TABLES = ["substitution_events", "substitution_requests", "team_execution_leases"];
const SCAFFOLD_TYPES = ["execution_mode", "request_status"];

type JournalEntry = { idx: number; tag: string };
const copies: string[] = [];

afterEach(() => {
  for (const folder of copies.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// The migrations up to `lastIndex`, as a database deployed then has applied them.
function migrationsThrough(lastIndex: number): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const entries = (journal.entries as JournalEntry[]).filter((entry) => entry.idx <= lastIndex);
  const folder = mkdtempSync(join(tmpdir(), "injurysub-migrations-"));
  copies.push(folder);
  mkdirSync(join(folder, "meta"));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) {
    cpSync(join(migrationsFolder, `${tag}.sql`), join(folder, `${tag}.sql`));
  }
  return folder;
}

async function tablesNamed(pool: Pool, names: string[]): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1) order by table_name",
    [names]
  );
  return rows.map((row) => row.table_name);
}

async function typesNamed(pool: Pool, names: string[]): Promise<string[]> {
  const { rows } = await pool.query<{ typname: string }>(
    "select typname from pg_type where typname = any($1) order by typname",
    [names]
  );
  return rows.map((row) => row.typname);
}

async function appliedMigrations(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "select count(*) from drizzle.__drizzle_migrations"
  );
  return Number(rows[0]?.count);
}

describe("migration 0006", () => {
  unmigratedDbTest(
    "takes an empty database through every migration, leaving no scaffold table or type",
    async ({ database }) => {
      const { pool } = database.connection;

      await migrate(drizzle(pool), { migrationsFolder });

      expect(await tablesNamed(pool, [...SCAFFOLD_TABLES, "espn_writes"])).toEqual(["espn_writes"]);
      expect(await typesNamed(pool, SCAFFOLD_TYPES)).toEqual([]);
    }
  );

  // Production is at 0004 and 5b ships 0005 and 0006 together, which drizzle applies in one
  // transaction: a scaffold row stops the deploy's pre-deploy step and leaves 0004 as it was.
  unmigratedDbTest(
    "refuses to drop a scaffold table that holds a row, leaving a database at 0004 as it was",
    async ({ database }) => {
      const { pool } = database.connection;
      await migrate(drizzle(pool), { migrationsFolder: migrationsThrough(4) });
      await pool.query(
        `insert into substitution_requests (request_id, team_id, matchup_period_id, execution_mode,
           status, injured_player_id, replacement_player_id, preview_adjustment, lineup_resolution)
         values (gen_random_uuid(), 1, 1, 'auto_execute', 'queued', 2, 20, 0, '{}')`
      );

      // drizzle carries pg's error as the cause; the guard's own message, not any failure.
      await expect(migrate(drizzle(pool), { migrationsFolder })).rejects.toMatchObject({
        cause: { message: expect.stringContaining("one holds a row") },
      });

      expect(await appliedMigrations(pool)).toBe(5);
      expect(await tablesNamed(pool, [...SCAFFOLD_TABLES, "espn_writes"])).toEqual(SCAFFOLD_TABLES);
      const { rows } = await pool.query("select count(*)::int as count from substitution_requests");
      expect(rows[0]?.count).toBe(1);
    }
  );
});
