import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Logger } from "@injurysub/config";

export type WorkerRuntimeSnapshot = {
  instanceId: string;
  startedAt: string;
  sweepIntervalMs: number;
  lastReconciledAt: string | null;
  lastSweepAt: string | null;
};

export type WorkerRuntimeState = {
  markReconciled: () => void;
  markSweep: () => void;
  snapshot: () => WorkerRuntimeSnapshot;
};

export type WorkerHealthDependencyCheck = {
  name: string;
  check: () => Promise<void>;
};

export function createWorkerRuntimeState(sweepIntervalMs: number): WorkerRuntimeState {
  const state: WorkerRuntimeSnapshot = {
    instanceId: randomUUID(),
    startedAt: new Date().toISOString(),
    sweepIntervalMs,
    lastReconciledAt: null,
    lastSweepAt: null,
  };

  return {
    markReconciled() {
      state.lastReconciledAt = new Date().toISOString();
    },
    markSweep() {
      state.lastSweepAt = new Date().toISOString();
    },
    snapshot() {
      return { ...state };
    },
  };
}

export function startWorkerHealthServer(
  port: number,
  runtimeState: WorkerRuntimeState,
  logger: Logger,
  dependencyChecks: WorkerHealthDependencyCheck[] = []
): Server {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    const dependencies: Record<string, "ok" | "error"> = {};

    for (const dependencyCheck of dependencyChecks) {
      try {
        await dependencyCheck.check();
        dependencies[dependencyCheck.name] = "ok";
      } catch {
        dependencies[dependencyCheck.name] = "error";
      }
    }

    const hasFailures = Object.values(dependencies).includes("error");

    response.writeHead(hasFailures ? 503 : 200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: !hasFailures,
        dependencies,
        service: "worker",
        ...runtimeState.snapshot(),
      })
    );
  });

  server.listen(port, () => {
    logger.info("worker.health.ready", {
      port,
    });
  });

  return server;
}
