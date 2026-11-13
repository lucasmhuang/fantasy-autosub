import { acquireWriteLease, findOldestQueuedRequest, releaseWriteLease } from "@injurysub/db";
import type { EspnMode } from "@injurysub/espn";
import type { ScheduledTask } from "../loops/scheduler";
import { LEASE_TTL_SECONDS } from "./claim";
import { type ExecutorContext, type PreflightOutcome, preflightRequest } from "./preflight";

export type ExecutorPassResult = { kind: "lease_held" } | { kind: "idle" } | PreflightOutcome;

// One pass of the executor: under the one ESPN-write lease, the queued request that has waited
// longest is checked and, if its checks pass, claimed. One request a pass; the next pass takes
// the next. While another worker holds the lease (two overlap during a deploy), it does nothing.
export async function runExecutorPass(context: ExecutorContext): Promise<ExecutorPassResult> {
  const { db } = context.connection;
  const lease = await acquireWriteLease(db, {
    holder: context.holder,
    ttlSeconds: LEASE_TTL_SECONDS,
  });
  if (lease === null) return { kind: "lease_held" };
  try {
    const request = await findOldestQueuedRequest(db);
    if (request === null) return { kind: "idle" };
    return await preflightRequest({ ...context, lease }, request);
  } finally {
    await releaseWriteLease(db, lease);
  }
}

// The executor's scheduled task. Without the cookie (ESPN_MODE=none) every read is refused, so
// there's nothing it could check or send, and it isn't scheduled.
export function executorTasks(input: {
  mode: EspnMode;
  run: () => Promise<void>;
}): ScheduledTask[] {
  return input.mode === "none" ? [] : [{ name: "executor", run: input.run }];
}
