import { type DatabaseExecutor, recordWorkerHeartbeat } from "@injurysub/db";
import type { ScheduledTask } from "./loops/scheduler";

// This worker's beat, as a scheduled task (O8): the uptime endpoint and the request pages read
// the newest beat of any worker.
export function heartbeatTask(input: {
  db: DatabaseExecutor;
  workerId: string;
  startedAt: Date;
  clock: () => Date;
}): ScheduledTask {
  return {
    name: "heartbeat",
    run: () =>
      recordWorkerHeartbeat(input.db, {
        workerId: input.workerId,
        startedAt: input.startedAt,
        beatAt: input.clock(),
      }),
  };
}
