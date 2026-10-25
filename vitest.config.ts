import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "apps/web/e2e/**", "**/.next/**"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
