import { and, asc, eq, sql } from "drizzle-orm";
import type { DatabaseConnection, DatabaseExecutor } from "./client";
import { espnWriteLock, type espnWriteOutcomeEnum, espnWrites } from "./schema";

type EspnWriteOutcome = (typeof espnWriteOutcomeEnum.enumValues)[number];

export type WriteLease = { holder: string; token: number };
export type WriteAttemptRecord = typeof espnWrites.$inferSelect;
export type NewWriteAttempt = Pick<
  typeof espnWrites.$inferInsert,
  "writeId" | "requestId" | "kind" | "teamId" | "matchupId" | "scoringPeriodId" | "body"
>;

function expiresIn(ttlSeconds: number) {
  return sql`now() + ${ttlSeconds}::integer * interval '1 second'`;
}

// Takes the lease when nobody holds it or its holder's time ran out, raising the token on every
// takeover; null while another holder's lease stands. The database's clock decides.
export async function acquireWriteLease(
  db: DatabaseExecutor,
  input: { holder: string; ttlSeconds: number }
): Promise<WriteLease | null> {
  const [lease] = await db
    .insert(espnWriteLock)
    .values({ lockId: 1, holder: input.holder, token: 1, expiresAt: expiresIn(input.ttlSeconds) })
    .onConflictDoUpdate({
      target: espnWriteLock.lockId,
      set: {
        holder: input.holder,
        token: sql`${espnWriteLock.token} + 1`,
        expiresAt: expiresIn(input.ttlSeconds),
      },
      setWhere: sql`${espnWriteLock.expiresAt} <= now()`,
    })
    .returning({ holder: espnWriteLock.holder, token: espnWriteLock.token });
  return lease ?? null;
}

// Extends the lease for its holder at its token, and is the fencing check before every send:
// false means another worker took over, so nothing may be sent.
export async function renewWriteLease(
  db: DatabaseExecutor,
  input: WriteLease & { ttlSeconds: number }
): Promise<boolean> {
  const renewed = await db
    .update(espnWriteLock)
    .set({ expiresAt: expiresIn(input.ttlSeconds) })
    .where(and(eq(espnWriteLock.holder, input.holder), eq(espnWriteLock.token, input.token)))
    .returning({ token: espnWriteLock.token });
  return renewed.length === 1;
}

// Ends the lease now, keeping its token so the next holder's is higher.
export async function releaseWriteLease(db: DatabaseExecutor, lease: WriteLease): Promise<boolean> {
  const released = await db
    .update(espnWriteLock)
    .set({ expiresAt: sql`now()` })
    .where(and(eq(espnWriteLock.holder, lease.holder), eq(espnWriteLock.token, lease.token)))
    .returning({ token: espnWriteLock.token });
  return released.length === 1;
}

// The step just before an ESPN send: the fencing check and the attempt's `sending` row, committed
// together before it returns (AC2-10). Null when the lease is lost: nothing is recorded, and the
// caller sends nothing.
export async function recordWriteAttempt(
  connection: DatabaseConnection,
  input: { lease: WriteLease; ttlSeconds: number; attempt: NewWriteAttempt }
): Promise<string | null> {
  return connection.transaction(async (tx) => {
    const held = await renewWriteLease(tx, { ...input.lease, ttlSeconds: input.ttlSeconds });
    if (!held) return null;
    await tx
      .insert(espnWrites)
      .values({ ...input.attempt, fencingToken: input.lease.token, status: "sending" });
    return input.attempt.writeId;
  });
}

// What ESPN answered: accepted, an error (its code says whether it may have applied), or nothing
// sent in rehearsal.
export async function recordWriteAnswer(
  db: DatabaseExecutor,
  writeId: string,
  answer: { status: "answered" | "failed" | "recorded_only"; failureCode: string | null }
): Promise<void> {
  await db
    .update(espnWrites)
    .set({ status: answer.status, failureCode: answer.failureCode, respondedAt: sql`now()` })
    .where(eq(espnWrites.writeId, writeId));
}

// What a read of ESPN showed after the write, which decides it.
export async function recordWriteReadback(
  db: DatabaseExecutor,
  writeId: string,
  result: { outcome: EspnWriteOutcome; readback: unknown }
): Promise<void> {
  await db
    .update(espnWrites)
    .set({ outcome: result.outcome, readback: result.readback, readBackAt: sql`now()` })
    .where(eq(espnWrites.writeId, writeId));
}

export async function listWriteAttempts(
  db: DatabaseExecutor,
  requestId: string
): Promise<WriteAttemptRecord[]> {
  return db
    .select()
    .from(espnWrites)
    .where(eq(espnWrites.requestId, requestId))
    .orderBy(asc(espnWrites.sentAt));
}
