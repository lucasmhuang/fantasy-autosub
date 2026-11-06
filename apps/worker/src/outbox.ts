import type { Logger } from "@injurysub/config";
import {
  claimPendingEmails,
  type DatabaseExecutor,
  markEmailFailed,
  markEmailSent,
  type OutboxEmailRecord,
} from "@injurysub/db";
import { type EmailClient, EmailError, isRetryableEmailFailure } from "@injurysub/email";

// A claim older than this is taken again: its sender died, or its send is worth retrying.
const CLAIM_LAPSE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;

type OutboxSweep = { db: DatabaseExecutor; email: EmailClient; logger: Logger; now: Date };

// Sends the queued emails. Each claim is committed (one statement) before its send, and each
// send carries the email's dedupe key as Resend's idempotency key, so two workers, or a retry,
// deliver an email once. A retryable failure leaves the email claimed until the claim lapses; a
// refusal, or a third failure, marks it failed.
export async function sendPendingEmails(sweep: OutboxSweep): Promise<void> {
  const claimed = await claimPendingEmails(sweep.db, {
    now: sweep.now,
    claimLapsedBefore: new Date(sweep.now.getTime() - CLAIM_LAPSE_MS),
    maxAttempts: MAX_ATTEMPTS,
    limit: BATCH_SIZE,
  });
  for (const row of claimed) await sendClaimed(row, sweep);
}

async function sendClaimed(row: OutboxEmailRecord, sweep: OutboxSweep): Promise<void> {
  const { db, now, logger } = sweep;
  try {
    await sweep.email.send(
      { to: row.toAddress, subject: row.subject, text: row.body },
      { idempotencyKey: row.dedupeKey }
    );
    await markEmailSent(db, { emailId: row.emailId, now });
  } catch (error) {
    if (!(error instanceof EmailError)) throw error;
    const willRetry = isRetryableEmailFailure(error) && row.attempts < MAX_ATTEMPTS;
    // Never the address: the email id and the client's code only.
    logger.warn("worker.outbox.send_failed", {
      emailId: row.emailId,
      code: error.code,
      attempt: row.attempts,
      willRetry,
    });
    if (!willRetry)
      await markEmailFailed(db, { emailId: row.emailId, now, failureCode: error.code });
  }
}
