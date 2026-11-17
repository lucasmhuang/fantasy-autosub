import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../drizzle/", import.meta.url);
const file = readdirSync(directory).find((name) => name.startsWith("0011_"));
const migration = file === undefined ? "" : readFileSync(new URL(file, directory), "utf8");

// Railway runs migrations while the previous version still serves, so 0011 may only add a column
// that version can leave out (RS-EMAIL-6).
describe("migration 0011", () => {
  it("adds the outbox's HTML part as an empty-by-default column, and nothing else", () => {
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");

    expect(statements).toEqual(['ALTER TABLE "email_outbox" ADD COLUMN "html" text;']);
  });
});
