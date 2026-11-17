import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { emailOutbox } from "./schema";

export type OutboxEmailRecord = typeof emailOutbox.$inferSelect;
export type NewOutboxEmail = Pick<
  typeof emailOutbox.$inferInsert,
  "emailId" | "dedupeKey" | "toAddress" | "subject" | "body" | "html" | "createdAt" | "requestId"
>;

// False when an email with this dedupe key is already queued (or was sent).
export async function enqueueEmail(db: DatabaseExecutor, email: NewOutboxEmail): Promise<boolean> {
  const rows = await db
    .insert(emailOutbox)
    .values(email)
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    .returning({ emailId: emailOutbox.emailId });
  return rows.length > 0;
}

// Claims up to `limit` emails to send, each counting as an attempt, in one statement whose rows
// another claimer skips. The caller commits the claim before sending. An email claimed before
// `claimLapsedBefore` and never marked (its sender died, or its send may be retried) can be
// claimed again, until it has used `maxAttempts`.
export async function claimPendingEmails(
  db: DatabaseExecutor,
  input: { now: Date; claimLapsedBefore: Date; maxAttempts: number; limit: number }
): Promise<OutboxEmailRecord[]> {
  const claimable = db
    .select({ emailId: emailOutbox.emailId })
    .from(emailOutbox)
    .where(
      and(
        isNull(emailOutbox.sentAt),
        isNull(emailOutbox.failedAt),
        lt(emailOutbox.attempts, input.maxAttempts),
        or(isNull(emailOutbox.claimedAt), lt(emailOutbox.claimedAt, input.claimLapsedBefore))
      )
    )
    .orderBy(asc(emailOutbox.createdAt))
    .limit(input.limit)
    .for("update", { skipLocked: true });
  return db
    .update(emailOutbox)
    .set({ claimedAt: input.now, attempts: sql`${emailOutbox.attempts} + 1` })
    .where(inArray(emailOutbox.emailId, claimable))
    .returning();
}

export async function markEmailSent(
  db: DatabaseExecutor,
  input: { emailId: string; now: Date }
): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ sentAt: input.now })
    .where(eq(emailOutbox.emailId, input.emailId));
}

// `failureCode` is the email client's error code, never the provider's message.
export async function markEmailFailed(
  db: DatabaseExecutor,
  input: { emailId: string; now: Date; failureCode: string }
): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ failedAt: input.now, failureCode: input.failureCode })
    .where(eq(emailOutbox.emailId, input.emailId));
}

// Whether a request's alert email went out, read from its newest outbox row; unknown when no row
// names the request (one queued before rows named their request, or a request that emailed nobody).
export type AlertEmailState =
  | { state: "unknown" }
  | { state: "pending" }
  | { state: "sent"; at: Date }
  | { state: "failed"; at: Date; code: string | null };

export async function findRequestAlertEmailState(
  db: DatabaseExecutor,
  requestId: string
): Promise<AlertEmailState> {
  const [row] = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.requestId, requestId))
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.emailId))
    .limit(1);
  if (row === undefined) return { state: "unknown" };
  if (row.sentAt !== null) return { state: "sent", at: row.sentAt };
  if (row.failedAt !== null) return { state: "failed", at: row.failedAt, code: row.failureCode };
  return { state: "pending" };
}
