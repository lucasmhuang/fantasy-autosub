export function createStartupReconciliationLoop() {
  return async function runStartupReconciliation() {
    console.log("injurysub-worker:reconcile", {
      message:
        "Startup reconciliation placeholder. This will inspect queued and executing requests.",
    });
  };
}

export function createSweepLoop() {
  return function startSweepLoop() {
    const intervalMs = 15_000;
    console.log("injurysub-worker:sweep", {
      intervalMs,
      message: "Lease and queue sweep placeholder started.",
    });

    setInterval(() => {
      console.log("injurysub-worker:sweep:tick", {
        intervalMs,
      });
    }, intervalMs);
  };
}
