import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Logger } from "@injurysub/config";

export type WorkerRuntimeSnapshot = {
  instanceId: string;
  startedAt: string;
  sweepIntervalMs: number;
  lastSweepAt: string | null;
};

export type WorkerRuntimeState = {
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
    lastSweepAt: null,
  };

  return {
    markSweep() {
      state.lastSweepAt = new Date().toISOString();
    },
    snapshot() {
      return { ...state };
    },
  };
}

// The health answer: 503 until the worker is ready (its database at this version's migrations),
// or while a dependency's check fails. Railway's deploy healthcheck waits for a 200.
export async function answerHealth(
  response: ServerResponse,
  input: {
    runtimeState: WorkerRuntimeState;
    logger: Logger;
    dependencyChecks: WorkerHealthDependencyCheck[];
    ready: boolean;
  }
): Promise<void> {
  const dependencies: Record<string, "ok" | "error"> = {};
  for (const dependencyCheck of input.dependencyChecks) {
    try {
      await dependencyCheck.check();
      dependencies[dependencyCheck.name] = "ok";
    } catch (error) {
      dependencies[dependencyCheck.name] = "error";
      input.logger.error("worker.health.dependency_failed", error, {
        dependency: dependencyCheck.name,
      });
    }
  }

  const healthy = input.ready && !Object.values(dependencies).includes("error");
  response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok: healthy,
      ready: input.ready,
      dependencies,
      service: "worker",
      ...input.runtimeState.snapshot(),
    })
  );
}
