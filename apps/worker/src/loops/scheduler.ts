import type { Logger } from "@injurysub/config";

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
        input.logger.error("worker.task.failed", error, { task: task.name });
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
