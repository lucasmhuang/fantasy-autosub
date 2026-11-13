import { Client } from "pg";
import { describe, expect, it } from "vitest";

const guardDatabaseUrl = `postgres://use-the-test-database-fixture@${process.env.PGHOST}:1/none`;
// The setup file picks one of these by platform.
const deadHosts = ["127.0.0.1", "127.0.0.2"];

// The guard comes from the Vitest setup file (vitest.setup.ts at the repo root), not from an import.
// Its address must refuse at once: one that never answers would hang code under test until the
// test's own time limit, since pg sets no connect timeout by default. Each test first checks that
// the guard is in place, without printing the setting, so that with the guard missing it never
// connects to whatever database the shell names.
describe("database guard", () => {
  it("refuses a connection built from the app's database setting at once", async () => {
    const isGuarded = process.env.DATABASE_URL === guardDatabaseUrl;
    expect(isGuarded, "DATABASE_URL isn't the guard's dead address").toBe(true);
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 1_000,
    });

    await expect(client.connect()).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("refuses a connection built from pg's own defaults at once", async () => {
    const isGuarded = deadHosts.includes(process.env.PGHOST ?? "") && process.env.PGPORT === "1";
    expect(isGuarded, "PGHOST and PGPORT aren't the guard's dead address").toBe(true);
    const client = new Client({ connectionTimeoutMillis: 1_000 });

    await expect(client.connect()).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
