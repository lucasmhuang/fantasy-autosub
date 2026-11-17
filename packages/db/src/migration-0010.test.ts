import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../drizzle/", import.meta.url);
const file = readdirSync(directory).find((name) => name.startsWith("0010_"));
const migration = file === undefined ? "" : readFileSync(new URL(file, directory), "utf8");

// Railway runs migrations while the previous version still serves, so 0010 may only add: a new
// enum value that version never reads, tables it never queries, and columns it can leave empty.
describe("migration 0010", () => {
  it("creates the stored rules check and the team names", () => {
    const created = [...migration.matchAll(/CREATE (TYPE|TABLE) "(?:public"\.")?([a-z_]+)"/g)].map(
      (match) => match[2]
    );

    expect(created.sort()).toEqual(["league_rules_check", "teams"]);
  });

  it("adds the switch time and the alerts' players, each one an older writer can leave out", () => {
    const added = [...migration.matchAll(/ALTER TABLE "([a-z_]+)" ADD COLUMN ([^;]+);/g)].map(
      (match) => `${match[1]}: ${match[2]}`
    );

    expect(added.sort()).toEqual([
      'league_settings: "automation_changed_at" timestamp with time zone',
      "misuse_alerts: \"players\" jsonb DEFAULT '[]'::jsonb NOT NULL",
    ]);
  });

  it("adds not_connected to ESPN access, and alters no type otherwise", () => {
    const altered = [...migration.matchAll(/ALTER TYPE [^;]+;/g)].map((match) => match[0]);

    expect(altered).toEqual([`ALTER TYPE "public"."espn_access_state" ADD VALUE 'not_connected';`]);
    expect(migration).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN/i);
  });
});
