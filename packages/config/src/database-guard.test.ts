import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

const guardDatabaseUrl = "postgres://use-the-test-database-fixture@127.0.0.2:1/none";

// The guard comes from the Vitest setup file (vitest.setup.ts at the repo root), not from an import.
// Nothing listens on port 1, so a connection built from these settings is refused, whatever the
// shell holds. The checks never print a setting's value: with the guard missing, it would be the
// shell's, perhaps a hosted database's URL with its password.
describe("database guard", () => {
  it("points the app's database setting at a dead local address", () => {
    const isGuarded = loadServerEnv().DATABASE_URL === guardDatabaseUrl;

    expect(isGuarded, "DATABASE_URL isn't the guard's dead address").toBe(true);
  });

  it("points pg's own defaults at the same dead address", () => {
    const isGuarded = process.env.PGHOST === "127.0.0.2" && process.env.PGPORT === "1";

    expect(isGuarded, "PGHOST and PGPORT aren't the guard's dead address").toBe(true);
  });
});
