import { configDefaults, defineConfig } from "vitest/config";

const sharedExclude = [...configDefaults.exclude, "apps/web/e2e/**", "**/.next/**"];

// Both projects inherit the root's environment and setup files (extends: true).
// The root sets no include or exclude: Vitest would join them onto each project's own.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
          exclude: [...sharedExclude, "**/*.db.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["apps/**/*.db.test.{ts,tsx}", "packages/**/*.db.test.{ts,tsx}"],
          exclude: sharedExclude,
          // Runs only when a database test file is selected, so unit-only runs never start Docker.
          globalSetup: ["./vitest.db-setup.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
