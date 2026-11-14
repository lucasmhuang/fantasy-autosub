import {
  appendEvent,
  describeFailure,
  getRequestDetail,
  isDatabaseQueryError,
  type SubRequestRecord,
} from "@injurysub/db";
import { systemEvent } from "./claim";
import { MAX_TRIES } from "./espn-write";
import type { ExecutorContext } from "./preflight";
import { moveToReview } from "./review";

// Runs a pass's work on one request. A pass that throws leaves the request as it stood, and the
// next pass meets the same request first, so a failure that repeats would hold up every request
// behind it with only a log line to show for it (X20). Each failed pass is counted on the request,
// and at the limit it goes to the commissioner. The error is rethrown for the scheduler's log.
export async function countingFailures<T>(
  context: ExecutorContext,
  request: SubRequestRecord,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await recordFailedPass(context, request.requestId, error);
    throw error;
  }
}

// While the database can't be reached the failure can't be counted; the pass's own error is the
// one that matters, so this one is logged and the count stays where it was.
async function recordFailedPass(
  context: ExecutorContext,
  requestId: string,
  error: unknown
): Promise<void> {
  try {
    await countFailedPass(context, requestId, nameOf(error));
  } catch (recordingError) {
    if (!isDatabaseQueryError(recordingError)) throw recordingError;
    context.logger.error("worker.executor.pass_failure_unrecorded", undefined, {
      requestId,
      reason: describeFailure(recordingError),
    });
  }
}

// An error's name, or a query failure's code: never a message, which can carry a query's
// parameters.
function nameOf(error: unknown): string {
  if (isDatabaseQueryError(error)) return describeFailure(error);
  return error instanceof Error ? error.name : "unknown";
}

const IN_HAND: readonly string[] = ["queued", "executing"];

async function countFailedPass(
  context: ExecutorContext,
  requestId: string,
  error: string
): Promise<void> {
  const { db } = context.connection;
  const detail = await getRequestDetail(db, requestId);
  if (detail === null || !IN_HAND.includes(detail.request.status)) return;
  const earlier = detail.events.filter(({ eventType }) => eventType === "pass_failed");
  const failures = earlier.length + 1;
  const at = context.clock();
  if (failures < MAX_TRIES) {
    await appendEvent(db, requestId, systemEvent("pass_failed", { error }, at));
    return;
  }
  const found = { detail: "pass_failed", error, failures };
  await moveToReview(context, detail.request, { reason: "ambiguous", found, patch: {}, at });
}
