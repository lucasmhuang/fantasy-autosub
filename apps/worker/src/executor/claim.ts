import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseConnection,
  type NewSubRequestEvent,
  renewWriteLease,
  type SubRequestRecord,
  transitionRequest,
  type WriteLease,
} from "@injurysub/db";
import { executorTransition, type RequestEventType } from "@injurysub/domain";

// Twice the ESPN deadlines in the longest stretch a pass goes without renewing the lease
// (lease.test.ts), so another worker almost never takes over while a pass still runs. Database
// statements in that stretch aren't counted: a database slow on every statement can outlast it.
// Writes stay safe either way: each send's fence checks the token, and each settle the request's
// version. A deploy hands the lease over at once: a stopping worker finishes its step and releases
// it.
export const LEASE_TTL_SECONDS = 300;

export function systemEvent(
  eventType: RequestEventType,
  payload: Record<string, unknown>,
  now: Date
): NewSubRequestEvent {
  return {
    eventId: randomUUID(),
    actorType: "system",
    actorUserId: null,
    eventType,
    payload,
    createdAt: now,
  };
}

// Moves a request whose preflight passed to executing, under the lease: in one transaction, the
// fencing check, the move at the version preflight read, and its event. Null when another worker
// took the lease over or a person acted on the request first; then nothing changed. Every claim
// clears the rehearsal mark, which only a rehearsed run sets again, so the mark describes the
// request's latest run even when recovery settles a write this run sent (S13).
export async function claimRequest(
  context: { connection: DatabaseConnection; lease: WriteLease; now: Date },
  request: SubRequestRecord,
  found: Record<string, unknown>
): Promise<SubRequestRecord | null> {
  const next = executorTransition(request, { type: "claim" });
  if (!next.ok) return null;
  return context.connection.transaction(async (tx) => {
    const fenced = await renewWriteLease(tx, { ...context.lease, ttlSeconds: LEASE_TTL_SECONDS });
    if (!fenced) return null;
    const claimed = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: { status: next.status, isRehearsal: false },
      now: context.now,
    });
    if (claimed === null) return null;
    const payload = { ...found, fencingToken: context.lease.token };
    await appendEvent(tx, claimed.requestId, systemEvent("claimed", payload, context.now));
    return claimed;
  });
}
