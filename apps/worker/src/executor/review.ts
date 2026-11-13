import {
  appendEvent,
  type DatabaseConnection,
  type RequestPatch,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import { executorTransition, type ReviewReason } from "@injurysub/domain";
import { enqueueCommissionerEmail } from "../commissioner-email";
import { systemEvent } from "./claim";

export type ReviewOutcome = { kind: "sent_to_review"; reason: ReviewReason } | { kind: "lost" };

// Sends a request the executor can't carry out to the commissioner, at the version it read, in
// one transaction with its event and the commissioner's email. `patch` carries what the executor
// learned of ESPN's lineup on the way (its lineup state). Lost when a person or another worker
// changed the request first.
export async function moveToReview(
  context: { connection: DatabaseConnection },
  request: SubRequestRecord,
  review: { reason: ReviewReason; found: Record<string, unknown>; patch: RequestPatch; at: Date }
): Promise<ReviewOutcome> {
  const { reason, found, patch, at } = review;
  const next = executorTransition(request, { type: "review", reason });
  if (!next.ok) return { kind: "lost" };
  const moved = await context.connection.transaction(async (tx) => {
    const row = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: { ...patch, status: next.status, reviewReason: next.reviewReason },
      now: at,
    });
    if (row === null) return null;
    await appendEvent(tx, row.requestId, systemEvent("sent_to_review", { reason, ...found }, at));
    await enqueueCommissionerEmail(tx, row, at);
    return row;
  });
  return moved === null ? { kind: "lost" } : { kind: "sent_to_review", reason };
}
