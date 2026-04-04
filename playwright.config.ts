import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000"
  },
  webServer: {
    command: "pnpm --filter @injurysub/web dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI
  }
});

