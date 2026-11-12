import { createLogger } from "@injurysub/config";
import { enqueueEmail } from "@injurysub/db";
import { afterEach, describe, expect, vi } from "vitest";
import { dbTest } from "../test-support";
import { createScheduler } from "./scheduler";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureWorkerLog() {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  return {
    text: () => printed.join("\n"),
    events: (): Record<string, unknown>[] => printed.map((line) => JSON.parse(line)),
  };
}

describe("createScheduler's failed tasks", () => {
  // A failed query's message names its parameters: here an invented commissioner's address, as
  // the expiry sweep's outbox insert would carry the real one.
  dbTest("logs a failed query by its code, never its parameters", async ({ database }) => {
    const log = captureWorkerLog();
    const scheduler = createScheduler({
      intervalMs: 60_000,
      logger: createLogger("worker", "debug"),
      tasks: [
        {
          name: "outbox",
          run: async () => {
            await enqueueEmail(database.connection.db, {
              emailId: "not-a-uuid",
              dedupeKey: "invented-key",
              toAddress: "commissioner@example.test",
              subject: "Invented subject",
              body: "Invented body",
            });
          },
        },
      ],
    });

    scheduler.start();
    await scheduler.stop();

    expect(log.events()).toEqual([
      expect.objectContaining({ event: "worker.task.failed", task: "outbox", reason: "22P02" }),
    ]);
    expect(log.text()).not.toContain("example.test");
    expect(log.text()).not.toContain("Failed query");
  });
});
