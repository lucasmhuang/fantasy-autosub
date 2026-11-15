import { configDefaults, defineConfig } from "vitest/config";

const sharedExclude = [...configDefaults.exclude, "apps/web/e2e/**", "**/.next/**"];

// Both projects inherit the root's environment, setup files and JSX transform (extends: true).
// The root sets no include or exclude: Vitest would join them onto each project's own.
export default defineConfig({
  // React's automatic runtime, as Next compiles JSX, so a test needs no React in scope.
  esbuild: { jsx: "automatic" },
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
