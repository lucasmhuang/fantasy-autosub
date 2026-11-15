import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { dbTest } from "./test-support";

// Railway runs 0009 while the previous version still serves, and that version writes outbox rows
// naming none of 0009's columns.
describe("migration 0009 under the version it replaces", () => {
  dbTest(
    "takes an outbox row written without the new columns, leaving them empty",
    async ({ database }) => {
      const { db } = database.connection;

      await db.execute(sql`
      insert into email_outbox (email_id, dedupe_key, to_address, subject, body)
      values ('00000000-0000-4000-8000-000000000009', 'migration-0009', 'someone@example.test', 'Subject', 'Body')
    `);

      const { rows } = await db.execute<{
        request_id: string | null;
        template: string | null;
        template_data: unknown;
      }>(sql`select request_id, template, template_data from email_outbox`);
      expect(rows).toEqual([{ request_id: null, template: null, template_data: null }]);
    }
  );
});
