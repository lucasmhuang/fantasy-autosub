import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: resolve(repoRoot, "packages/db/src/schema/index.ts"),
  out: resolve(repoRoot, "packages/db/drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/injurysub",
  },
});
