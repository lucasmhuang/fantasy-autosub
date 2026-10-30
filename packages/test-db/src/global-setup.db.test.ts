import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";
import { runDocker } from "./container";
import { databaseGlobalSetup } from "./global-setup";

const journal: { entries: unknown[] } = JSON.parse(
  readFileSync(new URL("../../db/drizzle/meta/_journal.json", import.meta.url), "utf8")
);

async function queryAt<Row>(url: string, sql: string): Promise<Row[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

function urlOfDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("databaseGlobalSetup", () => {
  it("gives database tests the admin URL of a server on 127.0.0.1, off the dev database's ports", () => {
    const adminUrl = inject("testDatabaseAdminUrl");

    expect(adminUrl).toBeTypeOf("string");
    const { hostname, port } = new URL(adminUrl);
    expect(hostname).toBe("127.0.0.1");
    expect(["5432", "5433"]).not.toContain(port);
  });

  it("builds a template database with the schema the app's migrations make", async () => {
    const adminUrl = inject("testDatabaseAdminUrl");
    expect(adminUrl).toBeTypeOf("string");

    // Inspected through a clone: a connection to the template itself would block every other
    // test's clone of it.
    const clone = `setup_check_${randomBytes(4).toString("hex")}`;
    await queryAt(adminUrl, `create database ${clone} template injurysub_template`);
    try {
      const tables = await queryAt<{ name: string }>(
        urlOfDatabase(adminUrl, clone),
        "select table_schema || '.' || table_name as name from information_schema.tables where table_name in ('user_accounts', '__drizzle_migrations') order by name"
      );
      const [applied] = await queryAt<{ count: number }>(
        urlOfDatabase(adminUrl, clone),
        "select count(*)::int as count from drizzle.__drizzle_migrations"
      );

      expect(tables.map((table) => table.name)).toEqual([
        "drizzle.__drizzle_migrations",
        "public.user_accounts",
      ]);
      expect(applied?.count).toBe(journal.entries.length);
    } finally {
      await queryAt(adminUrl, `drop database ${clone} with (force)`);
    }
  });

  it("removes its server when the template can't be built", async () => {
    const setup = databaseGlobalSetup({ migrationsFolder: "/nonexistent-injurysub-migrations" });
    const provided: string[] = [];

    await expect(setup({ provide: (key) => provided.push(key) })).rejects.toThrow(
      "Can't find meta/_journal.json file"
    );

    // This worker's process id labels the server that setup started.
    const left = runDocker(
      ["ps", "-a", "-q", "--filter", `label=injurysub.test-db.pid=${process.pid}`],
      { timeoutMs: 10_000 }
    );
    expect(left.stdout.trim()).toBe("");
    expect(provided).toEqual([]);
  });
});
