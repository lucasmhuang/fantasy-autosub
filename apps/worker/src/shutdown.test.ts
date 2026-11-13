import { createLogger } from "@injurysub/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "./loops/scheduler";
import { stopWorker } from "./shutdown";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stopWorker", () => {
  it("lets a pass in progress finish before closing the server, then the database", async () => {
    const order: string[] = [];
    let finishPass: () => void = () => {};
    const pass = new Promise<void>((resolve) => {
      finishPass = resolve;
    });
    const scheduler = createScheduler({
      intervalMs: 60_000,
      logger: createLogger("worker"),
      tasks: [{ name: "executor", run: () => pass.then(() => void order.push("pass")) }],
    });
    scheduler.start();
    const httpServer = {
      close: (done: (error?: Error) => void) => {
        order.push("server");
        done();
      },
    };
    const database = { close: async () => void order.push("database") };

    const stopped = stopWorker({ schedulers: [scheduler], httpServer, database });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);

    finishPass();
    await stopped;
    expect(order).toEqual(["pass", "server", "database"]);
  });
});
