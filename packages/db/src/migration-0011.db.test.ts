import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { dbTest } from "./test-support";

// Railway runs 0011 while the previous version still serves, and that version's worker queues
// outbox rows naming no HTML part.
describe("migration 0011 under the version it replaces", () => {
  dbTest(
    "takes an outbox row written without an HTML part, leaving it empty",
    async ({ database }) => {
      const { db } = database.connection;

      await db.execute(sql`
      insert into email_outbox (email_id, dedupe_key, to_address, subject, body)
      values ('00000000-0000-4000-8000-000000000011', 'migration-0011', 'someone@example.test', 'Subject', 'Body')
    `);

      const { rows } = await db.execute<{ html: string | null }>(
        sql`select html from email_outbox`
      );
      expect(rows).toEqual([{ html: null }]);
    }
  );
});
