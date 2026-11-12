import type { Logger } from "@injurysub/config";
import { describeFailure, isDatabaseQueryError } from "@injurysub/db";

export type ScheduledTask = { name: string; run: () => Promise<void> };
export type Scheduler = { start: () => void; stop: () => Promise<void> };

// Runs its tasks in order, then waits `intervalMs` before the next run, so a slow run never
// overlaps the next. A failed task is logged and the others still run. stop() lets the run in
// progress finish (a step boundary for whatever it does) and starts no other.
export function createScheduler(input: {
  intervalMs: number;
  logger: Logger;
  tasks: ScheduledTask[];
}): Scheduler {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> = Promise.resolve();

  const runTasks = async () => {
    for (const task of input.tasks) {
      if (stopped) return;
      try {
        await task.run();
      } catch (error) {
        logTaskFailure(input.logger, task.name, error);
      }
    }
  };

  const tick = () => {
    current = runTasks().then(() => {
      if (!stopped) timer = setTimeout(tick, input.intervalMs);
    });
  };

  return {
    start: tick,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await current;
    },
  };
}

// A failed query's message and stack name its parameters (an address, an email's body), so it's
// logged by its code alone.
function logTaskFailure(logger: Logger, task: string, error: unknown): void {
  if (isDatabaseQueryError(error)) {
    logger.error("worker.task.failed", undefined, { task, reason: describeFailure(error) });
    return;
  }
  logger.error("worker.task.failed", error, { task });
}
