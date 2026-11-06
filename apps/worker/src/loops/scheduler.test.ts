import { setTimeout as sleep } from "node:timers/promises";
import { createLogger } from "@injurysub/config";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    logger: createLogger("worker", "debug"),
    events: (): Record<string, unknown>[] => printed.map((line) => JSON.parse(line)),
  };
}

describe("createScheduler", () => {
  it("never starts a run while the last one is still going", async () => {
    let running = 0;
    let mostAtOnce = 0;
    let runs = 0;
    const scheduler = createScheduler({
      intervalMs: 5,
      logger: captureWorkerLog().logger,
      tasks: [
        {
          name: "slow",
          run: async () => {
            running += 1;
            mostAtOnce = Math.max(mostAtOnce, running);
            await sleep(30);
            running -= 1;
            runs += 1;
          },
        },
      ],
    });

    scheduler.start();
    await sleep(150);
    await scheduler.stop();

    expect(mostAtOnce).toBe(1);
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  it("waits for the run in progress when stopped, then runs nothing more", async () => {
    const finished: number[] = [];
    let started = 0;
    const scheduler = createScheduler({
      intervalMs: 5,
      logger: captureWorkerLog().logger,
      tasks: [
        {
          name: "slow",
          run: async () => {
            started += 1;
            await sleep(40);
            finished.push(started);
          },
        },
      ],
    });

    scheduler.start();
    await sleep(10);
    await scheduler.stop();
    const finishedAtStop = finished.length;
    await sleep(60);

    expect(started).toBeGreaterThan(0);
    expect(finishedAtStop).toBe(started);
    expect(finished).toHaveLength(finishedAtStop);
  });

  it("logs a failed task and carries on with the others and the next run", async () => {
    const log = captureWorkerLog();
    let healthyRuns = 0;
    const scheduler = createScheduler({
      intervalMs: 5,
      logger: log.logger,
      tasks: [
        {
          name: "broken",
          run: async () => {
            throw new TypeError("invented failure");
          },
        },
        {
          name: "healthy",
          run: async () => {
            healthyRuns += 1;
          },
        },
      ],
    });

    scheduler.start();
    await sleep(40);
    await scheduler.stop();

    expect(healthyRuns).toBeGreaterThanOrEqual(2);
    expect(log.events()).toContainEqual(
      expect.objectContaining({ event: "worker.task.failed", task: "broken" })
    );
  });
});
