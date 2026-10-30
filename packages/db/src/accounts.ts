import { and, inArray, isNull, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { sessions, userAccounts } from "./schema";

// An account as the account seed writes it.
export type SyncedUserAccount = {
  userId: string;
  email: string;
  teamId: number | null;
  displayName: string;
  role: (typeof userAccounts.$inferSelect)["role"];
};

// Makes every other writer of user_accounts wait until this transaction ends. Reads aren't
// blocked, so sign-in carries on, seeing the accounts as they were until the commit. It holds only
// inside a transaction, which releases it when it ends.
export async function lockUserAccountsForSync(db: DatabaseExecutor) {
  await db.execute(sql`lock table ${userAccounts} in share row exclusive mode`);
}

export async function listUserAccounts(db: DatabaseExecutor) {
  return db.select().from(userAccounts);
}

export async function deactivateAllUserAccounts(db: DatabaseExecutor) {
  await db.update(userAccounts).set({ isActive: false });
}

// Inserts the account or, when its email is already stored, updates that account in place, so its
// user_id, and with it its sessions, stay. Either way it ends active.
export async function upsertUserAccountByEmail(db: DatabaseExecutor, account: SyncedUserAccount) {
  await db
    .insert(userAccounts)
    .values({ ...account, isActive: true })
    .onConflictDoUpdate({
      target: userAccounts.email,
      set: {
        teamId: account.teamId,
        displayName: account.displayName,
        role: account.role,
        isActive: true,
      },
    });
}

// Ends the users' open sessions for good: a revoked session stays revoked even if its account
// comes back. A session that already ended keeps its own time.
export async function revokeSessionsForUsers(
  db: DatabaseExecutor,
  userIds: string[],
  revokedAt: Date
) {
  if (userIds.length === 0) return;
  await db
    .update(sessions)
    .set({ revokedAt })
    .where(and(inArray(sessions.userId, userIds), isNull(sessions.revokedAt)));
}
