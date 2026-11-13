import type { Scheduler } from "./loops/scheduler";

// Stops the worker at a step boundary: each scheduler stops starting runs and the run in progress
// (an executor pass, readbacks included) finishes, so no write is left mid-send by the shutdown;
// then the health server closes, then the database pool. Railway drains for 60 s first.
export async function stopWorker(running: {
  schedulers: Scheduler[];
  httpServer: { close: (done: (error?: Error) => void) => unknown };
  database: { close: () => Promise<void> };
}): Promise<void> {
  await Promise.all(running.schedulers.map((scheduler) => scheduler.stop()));
  await new Promise<void>((resolve, reject) => {
    running.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
  await running.database.close();
}
