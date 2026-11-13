import { once } from "node:events";
import { createLogger } from "@injurysub/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerRuntimeState } from "./health";
import { startWorkerHttpServer } from "./http-server";
import { askServer } from "./test-http";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureWorkerLog() {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  return {
    logger: createLogger("worker", "debug"),
    events: (): Record<string, unknown>[] => printed.map((line) => JSON.parse(line)),
  };
}

describe("the worker's health endpoint", () => {
  it("answers 503 and logs the dependency whose check failed", async () => {
    const log = captureWorkerLog();
    const server = startWorkerHttpServer({
      port: 0,
      runtimeState: createWorkerRuntimeState(15_000),
      logger: log.logger,
      dependencyChecks: [
        {
          name: "database",
          check: async () => {
            throw new Error("connect ECONNREFUSED");
          },
        },
      ],
      isReady: () => true,
      espn: {
        getTeamWeek: async () => Promise.reject(new Error("not asked")),
        checkLeagueRules: async () => Promise.reject(new Error("not asked")),
      },
      sendMode: "never",
      internalToken: "t".repeat(64),
    });
    try {
      await once(server, "listening");

      const response = await askServer(server, { path: "/health" });

      expect(response.status).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({
        ok: false,
        dependencies: { database: "error" },
      });
      const failures = log
        .events()
        .filter((line) => line.event === "worker.health.dependency_failed");
      expect(failures).toMatchObject([{ dependency: "database" }]);
    } finally {
      server.close();
    }
  });
});
