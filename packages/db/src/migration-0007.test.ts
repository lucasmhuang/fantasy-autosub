import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../drizzle/", import.meta.url);
const file = readdirSync(directory).find((name) => name.startsWith("0007_"));
const migration = file === undefined ? "" : readFileSync(new URL(file, directory), "utf8");

// Railway runs migrations while the previous version still serves, so 0007 may only add.
describe("migration 0007", () => {
  it("creates the ESPN-access record and its type, and changes nothing else", () => {
    const created = [...migration.matchAll(/CREATE (TYPE|TABLE) "(?:public"\.")?([a-z_]+)"/g)].map(
      (match) => match[2]
    );

    expect(created.sort()).toEqual(["espn_access", "espn_access_state"]);
    expect(migration).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER TYPE|ALTER COLUMN/i);
  });
});
