import { createDbTest } from "@injurysub/test-db";
import { inject, test } from "vitest";
import { createDatabaseConnection } from "./client";

// The `test` for this package's *.db.test.ts files: each test gets its own migrated database and
// a connection to it. Test code only; the package entry doesn't export it.
export const dbTest = createDbTest({ test, inject }, (url) =>
  createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-test",
    maxConnections: 4,
  })
);
