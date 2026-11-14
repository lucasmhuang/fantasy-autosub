import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../drizzle/", import.meta.url);
const file = readdirSync(directory).find((name) => name.startsWith("0008_"));
const migration = file === undefined ? "" : readFileSync(new URL(file, directory), "utf8");

// Railway runs migrations while the previous version still serves, so 0008 may only add.
describe("migration 0008", () => {
  it("creates the misuse watch's tables, the heartbeats and the alert kind", () => {
    const created = [...migration.matchAll(/CREATE (TYPE|TABLE) "(?:public"\.")?([a-z_]+)"/g)].map(
      (match) => match[2]
    );

    expect(created.sort()).toEqual([
      "misuse_alert_kind",
      "misuse_alerts",
      "misuse_watch",
      "worker_heartbeats",
    ]);
  });

  it("adds one nullable column to the league's settings, and changes nothing else", () => {
    const added = [...migration.matchAll(/ALTER TABLE "([a-z_]+)" ADD COLUMN ([^;]+);/g)].map(
      (match) => [match[1], match[2]]
    );

    expect(added).toEqual([["league_settings", '"allowlist_before_off" integer[]']]);
    expect(migration).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER TYPE|ALTER COLUMN/i);
  });
});
