import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../drizzle/", import.meta.url);
const file = readdirSync(directory).find((name) => name.startsWith("0009_"));
const migration = file === undefined ? "" : readFileSync(new URL(file, directory), "utf8");

// Railway runs migrations while the previous version still serves, so 0009 may only add, and
// only columns that version can leave empty.
describe("migration 0009", () => {
  it("adds the device's zone, the outbox's request and template, and the season's end and practice mark", () => {
    const added = [...migration.matchAll(/ALTER TABLE "([a-z_]+)" ADD COLUMN ([^;]+);/g)].map(
      (match) => `${match[1]}: ${match[2]}`
    );

    expect(added.sort()).toEqual([
      'email_outbox: "request_id" uuid',
      'email_outbox: "template" text',
      'email_outbox: "template_data" jsonb',
      'league_settings: "practice_since" timestamp with time zone',
      'league_settings: "season_ended_at" timestamp with time zone',
      'league_settings: "season_final" jsonb',
      'sessions: "time_zone" text',
    ]);
  });

  it("links an outbox row to its request, and does nothing else", () => {
    const keys = [
      ...migration.matchAll(
        /ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "[a-z_]+" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "public"\."([a-z_]+)"\("([a-z_]+)"\)/g
      ),
    ].map((match) => match.slice(1));
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(keys).toEqual([["email_outbox", "request_id", "sub_requests", "request_id"]]);
    expect(statements).toHaveLength(8);
    expect(migration).not.toMatch(
      /\bDROP\b|\bRENAME\b|ALTER TYPE|ALTER COLUMN|NOT NULL|DEFAULT|CREATE (TABLE|TYPE|INDEX)/i
    );
  });
});
