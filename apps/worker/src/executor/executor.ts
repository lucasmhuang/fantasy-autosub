import {
  acquireWriteLease,
  findOldestExecutingRequest,
  findOldestQueuedRequest,
  releaseWriteLease,
  type SubRequestRecord,
  type WriteLease,
} from "@injurysub/db";
import type { EspnMode } from "@injurysub/espn";
import type { ScheduledTask } from "../loops/scheduler";
import { type AdjustmentStepOutcome, runAdjustmentStep } from "./adjustment-step";
import { LEASE_TTL_SECONDS } from "./claim";
import { type LineupStepOutcome, runLineupStep } from "./lineup-step";
import { countingFailures } from "./pass-failure";
import {
  type ExecutorContext,
  type PreflightOutcome,
  preflightRequest,
  type WriteStepContext,
} from "./preflight";
import { runProvingRun } from "./proving";
import { type RecoveryOutcome, recoverInterrupted, resumeAdjustment } from "./recovery";

export type ExecutorPassResult =
  | { kind: "lease_held" }
  | { kind: "idle" }
  | PreflightOutcome
  | LineupStepOutcome
  | AdjustmentStepOutcome
  | RecoveryOutcome;

// One pass of the executor: under the one ESPN-write lease, the queued request that has waited
// longest is checked and, if its checks pass, claimed; then its lineup edit is sent and read
// back, and once ESPN shows it, its adjustment. One request a pass; the next pass takes the next.
// While another worker holds the lease (two overlap during a deploy), it does nothing.
export async function runExecutorPass(context: ExecutorContext): Promise<ExecutorPassResult> {
  const { db } = context.connection;
  const lease = await acquireWriteLease(db, {
    holder: context.holder,
    ttlSeconds: LEASE_TTL_SECONDS,
  });
  if (lease === null) return { kind: "lease_held" };
  try {
    const { write } = context;
    // A request an earlier pass left executing is settled first (X20).
    const interrupted = write === null ? null : await findOldestExecutingRequest(db);
    if (interrupted !== null && write !== null) {
      const recovering = { ...context, lease, write };
      return await countingFailures(context, interrupted, () =>
        recoverInterrupted(recovering, interrupted)
      );
    }
    const request = await findOldestQueuedRequest(db);
    if (request === null) return { kind: "idle" };
    return await countingFailures(context, request, () =>
      runQueued({ ...context, lease }, request)
    );
  } finally {
    await releaseWriteLease(db, lease);
  }
}

async function runQueued(
  context: ExecutorContext & { lease: WriteLease },
  request: SubRequestRecord
): Promise<ExecutorPassResult> {
  const outcome = await preflightRequest(context, request);
  const { write } = context;
  if (outcome.kind !== "claimed" || write === null) return outcome;
  return runWrites({ ...context, write }, outcome);
}

// The lineup edit, then the adjustment once ESPN shows the edit; a request whose lineup was
// verified before (a re-approved held adjustment, or one put back in line) goes straight to the
// adjustment, any earlier write of it checked against ESPN first (AC1-1, S2). With sending
// switched off the lineup is only rehearsed, and the adjustment is worked out as if the edit had
// applied from the day its body named (S12). A proving request runs its own path, which no
// substitution's adjustment ever enters (S9).
async function runWrites(
  context: WriteStepContext,
  claimed: Extract<PreflightOutcome, { kind: "claimed" }>
): Promise<LineupStepOutcome | AdjustmentStepOutcome> {
  if (claimed.request.kind === "proving") return runProvingRun(context, claimed);
  if (claimed.resumeAt === "adjustment") return resumeAdjustment(context, claimed.request);
  const lineup = await runLineupStep(context, claimed);
  if (lineup.kind === "lineup_verified") return runAdjustmentStep(context, lineup.request);
  if (lineup.kind !== "rehearsed") return lineup;
  const rehearsal = { effectiveDay: lineup.day, lineupWriteId: lineup.writeId };
  return runAdjustmentStep(context, lineup.request, rehearsal);
}

// The executor's scheduled task. Without the cookie (ESPN_MODE=none) every read is refused, so
// there's nothing it could check or send, and it isn't scheduled.
export function executorTasks(input: {
  mode: EspnMode;
  run: () => Promise<void>;
}): ScheduledTask[] {
  return input.mode === "none" ? [] : [{ name: "executor", run: input.run }];
}
