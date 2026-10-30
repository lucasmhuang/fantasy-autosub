import { createDatabaseConnection } from "@injurysub/db";
import { createDbTest } from "@injurysub/test-db";
import { inject, test } from "vitest";

// The `test` for this app's *.db.test.ts files: each test gets its own migrated database and a
// connection to it. Test code only; nothing outside the tests imports it.
export const dbTest = createDbTest({ test, inject }, (url) =>
  createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-test",
    maxConnections: 4,
  })
);
