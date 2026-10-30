import { fileURLToPath } from "node:url";
import { databaseGlobalSetup } from "@injurysub/test-db";

// The database project's global setup. Its migrations folder is the one drizzle.config.ts writes.
export default databaseGlobalSetup({
  migrationsFolder: fileURLToPath(new URL("./packages/db/drizzle", import.meta.url)),
});
