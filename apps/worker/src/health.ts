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
  logger: Logger
): Server {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
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
