// How old the newest worker beat may be before the worker counts as down (OQ22, C6): the worker
// beats every sweep, after the executor's pass, so a hung pass stops the beats too.
export const WORKER_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

// Down when it never beat, or its newest beat is 3 minutes old or more.
export function isWorkerDown(lastBeatAt: Date | null, now: Date): boolean {
  return lastBeatAt === null || now.getTime() - lastBeatAt.getTime() >= WORKER_HEARTBEAT_STALE_MS;
}
