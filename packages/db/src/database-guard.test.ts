import { Client } from "pg";
import { describe, expect, it } from "vitest";

// The guard comes from the Vitest setup file (vitest.setup.ts at the repo root), not from an import.
// Its address must refuse at once: one that never answers would hang code under test until the
// test's own time limit, since pg sets no connect timeout by default.
describe("database guard", () => {
  it("refuses a connection built from the app's database setting at once", async () => {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 1_000,
    });

    await expect(client.connect()).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("refuses a connection built from pg's own defaults at once", async () => {
    const client = new Client({ connectionTimeoutMillis: 1_000 });

    await expect(client.connect()).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
