import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/0004_fixed_echo.sql", import.meta.url), "utf8");

// Railway runs migrations while the previous version still serves, so 0004 may only add. Its
// types are new names: the scaffold still owns request_status and execution_mode.
describe("migration 0004", () => {
  it("drops, renames and alters no existing type or table", () => {
    expect(migration).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER TYPE|ALTER COLUMN/i);
  });

  it("creates every type under a sub_request_ or league_ name", () => {
    const types = [...migration.matchAll(/CREATE TYPE "public"\."([a-z_]+)"/g)].map(
      (match) => match[1]
    );

    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((name) => !/^(sub_request|league)_/.test(name!))).toEqual([]);
  });

  it("alters only tables it creates", () => {
    const created = new Set(
      [...migration.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((match) => match[1])
    );
    const altered = [...migration.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((match) => match[1]);

    expect(altered.filter((name) => !created.has(name))).toEqual([]);
  });
});
