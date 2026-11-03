import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { signInCodes, userAccounts } from "./schema";

export type SignInCodeRecord = typeof signInCodes.$inferSelect;

export async function insertSignInCode(
  db: DatabaseExecutor,
  code: typeof signInCodes.$inferInsert
) {
  await db.insert(signInCodes).values(code);
}

// Locks the user's row until the transaction ends, so code requests for one user run one at a
// time while other users' don't wait. False for a disabled or unknown user.
export async function lockActiveUserAccount(db: DatabaseExecutor, userId: string) {
  const rows = await db
    .select({ userId: userAccounts.userId })
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, userId), eq(userAccounts.isActive, true)))
    .for("update");
  return rows.length > 0;
}

// Oldest first.
export async function listSignInCodeTimesSince(
  db: DatabaseExecutor,
  userId: string,
  since: Date
): Promise<Date[]> {
  const rows = await db
    .select({ createdAt: signInCodes.createdAt })
    .from(signInCodes)
    .where(and(eq(signInCodes.userId, userId), gt(signInCodes.createdAt, since)))
    .orderBy(asc(signInCodes.createdAt));
  return rows.map((row) => row.createdAt);
}

export async function findNewestSignInCode(db: DatabaseExecutor, userId: string) {
  const [row] = await db
    .select()
    .from(signInCodes)
    .where(eq(signInCodes.userId, userId))
    .orderBy(desc(signInCodes.createdAt))
    .limit(1);
  return row ?? null;
}

// Spends one try in a single conditional update, before the code is compared, so simultaneous
// guesses can't spend more than `maxAttempts`. Null when the code is used, expired or out of tries.
export async function spendSignInCodeAttempt(
  db: DatabaseExecutor,
  input: { codeId: string; now: Date; maxAttempts: number }
) {
  const [row] = await db
    .update(signInCodes)
    .set({ attempts: sql`${signInCodes.attempts} + 1` })
    .where(
      and(
        eq(signInCodes.codeId, input.codeId),
        isNull(signInCodes.usedAt),
        gt(signInCodes.expiresAt, input.now),
        lt(signInCodes.attempts, input.maxAttempts)
      )
    )
    .returning();
  return row ?? null;
}

// Null when the code was already used, so a code signs in once even when sent twice at once.
export async function markSignInCodeUsed(
  db: DatabaseExecutor,
  input: { codeId: string; now: Date }
) {
  const [row] = await db
    .update(signInCodes)
    .set({ usedAt: input.now })
    .where(and(eq(signInCodes.codeId, input.codeId), isNull(signInCodes.usedAt)))
    .returning();
  return row ?? null;
}

export async function expireSignInCode(db: DatabaseExecutor, input: { codeId: string; now: Date }) {
  await db
    .update(signInCodes)
    .set({ expiresAt: input.now })
    .where(eq(signInCodes.codeId, input.codeId));
}
