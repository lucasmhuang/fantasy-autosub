import type { Logger } from "@injurysub/config";
import type { WorkerRuntimeState } from "../health";

type RuntimeLoopDependencies = {
  intervalMs: number;
  logger: Logger;
  runtimeState: WorkerRuntimeState;
};

export function createStartupReconciliationLoop({
  logger,
  runtimeState,
}: Pick<RuntimeLoopDependencies, "logger" | "runtimeState">) {
  return async function runStartupReconciliation() {
    runtimeState.markReconciled();
    logger.info("worker.reconcile", {
      message:
        "Startup reconciliation placeholder. This will inspect queued and executing requests.",
    });
  };
}

export function createSweepLoop({ intervalMs, logger, runtimeState }: RuntimeLoopDependencies) {
  return function startSweepLoop() {
    logger.info("worker.sweep.start", {
      intervalMs,
      message: "Lease and queue sweep placeholder started.",
    });

    setInterval(() => {
      runtimeState.markSweep();
      logger.debug("worker.sweep.tick", {
        intervalMs,
      });
    }, intervalMs);
  };
}
