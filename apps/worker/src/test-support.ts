import { createDatabaseConnection } from "@injurysub/db";
import { createDbTest } from "@injurysub/test-db";
import { inject, test } from "vitest";

function connectForTests(url: string) {
  return createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-test",
    maxConnections: 4,
  });
}

// The `test` for this app's *.db.test.ts files: each test gets its own migrated database and a
// connection to it. Test code only; nothing outside the tests imports it.
export const dbTest = createDbTest({ test, inject }, connectForTests);

// The same, but each test's database is empty, without the app's schema.
export const unmigratedDbTest = createDbTest({ test, inject }, connectForTests, {
  migrated: false,
});
