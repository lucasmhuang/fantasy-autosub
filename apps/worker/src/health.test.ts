import { once } from "node:events";
import { request, type Server } from "node:http";
import { createLogger } from "@injurysub/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerRuntimeState, startWorkerHealthServer } from "./health";

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

// Tests can't use fetch (vitest.setup.ts guards it), so this asks over node:http.
function getHealth(server: Server): Promise<{ status: number; body: string }> {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the health server isn't listening on a TCP port");
  }
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port: address.port, path: "/health" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    })
      .on("error", reject)
      .end();
  });
}

describe("startWorkerHealthServer", () => {
  it("answers 503 and logs the dependency whose check failed", async () => {
    const log = captureWorkerLog();
    const server = startWorkerHealthServer(0, createWorkerRuntimeState(15_000), log.logger, [
      {
        name: "database",
        check: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    ]);
    try {
      await once(server, "listening");

      const response = await getHealth(server);

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
