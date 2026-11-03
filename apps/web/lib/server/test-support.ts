import { createLogger } from "@injurysub/config";
import { createDatabaseConnection } from "@injurysub/db";
import { createDbTest } from "@injurysub/test-db";
import { inject, test, vi } from "vitest";

// What the web logger wrote during one test: its JSON lines exactly as they'd reach the host's
// logs, and the same lines parsed.
export type WebLog = { lines: string[]; events: () => Record<string, unknown>[] };

function connectForTests(url: string) {
  return createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-test",
    maxConnections: 4,
  });
}

// The `test` for apps/web's *.db.test.ts files. Each test gets its own migrated database, which
// the web app's connection singleton returns; a fresh email client, built from the test's env; and
// the real web logger, whose lines are captured instead of printed. All three are cleared after.
// Test code only; nothing outside the tests imports it.
export const webDbTest = createDbTest({ test, inject }, connectForTests).extend<{ webLog: WebLog }>(
  {
    webLog: [
      // Vitest's fixture callback, named so React's hook lint doesn't take it for `use`.
      async ({ database }, runTest) => {
        const lines: string[] = [];
        const capture = (line: unknown) => {
          lines.push(String(line));
        };
        const consoleSpies = [
          vi.spyOn(console, "log").mockImplementation(capture),
          vi.spyOn(console, "warn").mockImplementation(capture),
          vi.spyOn(console, "error").mockImplementation(capture),
        ];
        globalThis.__injurysubWebDb = database.connection;
        globalThis.__injurysubWebEmailClient = undefined;
        globalThis.__injurysubWebLogger = createLogger("web", "debug");
        try {
          await runTest({
            lines,
            events: (): Record<string, unknown>[] => lines.map((line) => JSON.parse(line)),
          });
        } finally {
          globalThis.__injurysubWebDb = undefined;
          globalThis.__injurysubWebEmailClient = undefined;
          globalThis.__injurysubWebLogger = undefined;
          for (const spy of consoleSpies) spy.mockRestore();
        }
      },
      { auto: true },
    ],
  }
);
