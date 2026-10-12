import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const repoRoot = dirname(fileURLToPath(import.meta.url));

// Shell values win; loadEnvFile never overrides, so the first file loaded takes precedence.
for (const envFile of [".env.local", ".env"]) {
  const envPath = resolve(repoRoot, envFile);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

export default defineConfig({
  schema: resolve(repoRoot, "packages/db/src/schema/index.ts"),
  out: resolve(repoRoot, "packages/db/drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/injurysub",
  },
});
