import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

// The guard comes from the Vitest setup file (vitest.setup.ts at the repo root), not from an import.
// Nothing listens on port 1, so a connection built from these settings is refused, whatever the shell holds.
describe("database guard", () => {
  it("points the app's database setting at a dead local address", () => {
    expect(loadServerEnv().DATABASE_URL).toBe(
      "postgres://use-the-test-database-fixture@127.0.0.2:1/none"
    );
  });

  it("points pg's own defaults at the same dead address", () => {
    expect({ host: process.env.PGHOST, port: process.env.PGPORT }).toEqual({
      host: "127.0.0.2",
      port: "1",
    });
  });
});
