import { randomUUID } from "node:crypto";
import { AppError } from "@injurysub/config";
import {
  appendEvent,
  type NewWriteAttempt,
  type RequestPatch,
  recordWriteAnswer,
  recordWriteAttempt,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import type { RequestEventType } from "@injurysub/domain";
import {
  EspnError,
  type EspnErrorCode,
  type EspnWriteClient,
  type EspnWriteResult,
  type WriteGuard,
} from "@injurysub/espn";
import { LEASE_TTL_SECONDS, systemEvent } from "./claim";
import type { WriteStepContext } from "./preflight";

// What each ESPN write in the executor shares: the attempt committed behind the fencing check
// before the body leaves (AC2-10), ESPN's answer recorded, and a readback that decides it, never
// the answer (X10, S1).

// ESPN showed each write within a second of its answer so far (2026-10-29: 0.3 s and 0.5 s), so
// five reads two seconds apart leave room; one read for an answer that declined it.
const READBACK_ROUNDS = 5;
const READBACK_INTERVAL_MS = 2_000;

// The fencing check before a send found another worker holding the lease: nothing may be sent.
export class WriteLeaseLostError extends AppError {
  override readonly name = "WriteLeaseLostError";
}

// ESPN's own answer to a write it refused: its status and error type ("HTTP 400 <type>"), which
// the transport puts on the error's cause; null for a write ESPN took or never answered.
type Answered = { writeId: string; failureCode: EspnErrorCode | null; espnAnswer?: string | null };

export type SendResult =
  | ({ kind: "answered" } & Answered)
  | { kind: "recorded_only"; writeId: string }
  | { kind: "lost" };

type Attempt = Omit<NewWriteAttempt, "writeId" | "body">;

// Sends one write through the write client with a guard that commits its attempt first. A lost
// lease sends nothing; ESPN's refusals and lost answers come back as its error code.
export async function sendWrite(
  context: WriteStepContext,
  attempt: Attempt,
  allowlist: ReadonlySet<number>,
  send: (write: EspnWriteClient, guard: WriteGuard) => Promise<EspnWriteResult<unknown>>
): Promise<SendResult> {
  const writeId = randomUUID();
  const guard: WriteGuard = {
    allowlist,
    beforeSend: async (body) => {
      const recorded = await recordWriteAttempt(context.connection, {
        lease: context.lease,
        ttlSeconds: LEASE_TTL_SECONDS,
        attempt: { ...attempt, writeId, body },
      });
      if (recorded === null) throw new WriteLeaseLostError("another worker holds the lease");
    },
  };
  try {
    const result = await send(context.write, guard);
    if (result.outcome === "recorded_only") return { kind: "recorded_only", writeId };
    return { kind: "answered", writeId, failureCode: null };
  } catch (error) {
    if (error instanceof WriteLeaseLostError) return { kind: "lost" };
    if (error instanceof EspnError) {
      const espnAnswer = error.cause instanceof Error ? error.cause.message : null;
      return { kind: "answered", writeId, failureCode: error.code, espnAnswer };
    }
    throw error;
  }
}

// ESPN's answer on the attempt, then the request's state for that write and its event, together.
export async function recordAnswer(
  context: WriteStepContext,
  request: SubRequestRecord,
  sent: Answered,
  change: { patch: RequestPatch; eventType: RequestEventType; payload: Record<string, unknown> }
): Promise<SubRequestRecord | null> {
  const { writeId, failureCode } = sent;
  const answer = sent.espnAnswer ? { espnAnswer: sent.espnAnswer } : {};
  await recordWriteAnswer(context.connection.db, writeId, {
    status: failureCode === null ? "answered" : "failed",
    failureCode,
  });
  const at = context.clock();
  return context.connection.transaction(async (tx) => {
    const row = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: change.patch,
      now: at,
    });
    if (row === null) return null;
    const payload = { writeId, failureCode, ...answer, ...change.payload };
    await appendEvent(tx, row.requestId, systemEvent(change.eventType, payload, at));
    return row;
  });
}

// ESPN's answers that leave nothing on ESPN once a readback shows the write untouched, so the
// request runs again instead of going to the commissioner (O6): ESPN unavailable or the cookie
// refused (it declined the write), or no answer at all. A 200 or a refusal of the body is final.
const RETRYABLE_ANSWERS: readonly string[] = [
  "espn_unavailable",
  "credentials_rejected",
  "outcome_unknown",
];

export function mayRunAgain(failureCode: string | null): boolean {
  return failureCode !== null && RETRYABLE_ANSWERS.includes(failureCode);
}

export async function recordNotSent(context: WriteStepContext, writeId: string): Promise<void> {
  await recordWriteAnswer(context.connection.db, writeId, {
    status: "recorded_only",
    failureCode: null,
  });
}

// Reads ESPN back until `done` holds or the rounds run out: every round for an answer that may
// have applied (accepted, or lost on the way back), one for an answer that declined it. The last
// round read decides; null when no round could be read.
export async function pollReadback<T>(
  context: WriteStepContext,
  failureCode: EspnErrorCode | null,
  readOnce: () => Promise<T | null>,
  done: (read: T) => boolean
): Promise<T | null> {
  const mayHaveApplied = failureCode === null || failureCode === "outcome_unknown";
  const rounds = mayHaveApplied ? READBACK_ROUNDS : 1;
  let latest: T | null = null;
  for (let round = 0; round < rounds; round += 1) {
    if (round > 0) await context.sleep(READBACK_INTERVAL_MS);
    const read = await readOnce();
    if (read === null) continue;
    latest = read;
    if (done(read)) return read;
  }
  return latest;
}
