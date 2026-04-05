import { and, eq, gt, isNull } from "drizzle-orm";
import type { DatabaseClient } from "./client";
import { loginLinkTokens, sessions, userAccounts } from "./schema";

export type UserAccountRecord = typeof userAccounts.$inferSelect;
export type LoginLinkTokenRecord = typeof loginLinkTokens.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;

export type LoginLinkWithUserRecord = {
  token: LoginLinkTokenRecord;
  user: UserAccountRecord;
};

export type SessionWithUserRecord = {
  session: SessionRecord;
  user: UserAccountRecord;
};

export async function findActiveUserAccountByEmail(db: DatabaseClient, email: string) {
  const [user] = await db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.email, email), eq(userAccounts.isActive, true)))
    .limit(1);

  return user ?? null;
}

export async function findActiveUserAccountById(db: DatabaseClient, userId: string) {
  const [user] = await db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, userId), eq(userAccounts.isActive, true)))
    .limit(1);

  return user ?? null;
}

export async function createLoginLinkToken(
  db: DatabaseClient,
  token: typeof loginLinkTokens.$inferInsert
) {
  await db.insert(loginLinkTokens).values(token);
}

export async function findLoginLinkByToken(db: DatabaseClient, token: string) {
  const [row] = await db
    .select({
      token: loginLinkTokens,
      user: userAccounts,
    })
    .from(loginLinkTokens)
    .innerJoin(userAccounts, eq(loginLinkTokens.userId, userAccounts.userId))
    .where(eq(loginLinkTokens.token, token))
    .limit(1);

  if (!row) {
    return null;
  }

  return row satisfies LoginLinkWithUserRecord;
}

export async function consumeLoginLinkToken(
  db: DatabaseClient,
  input: {
    now: Date;
    token: string;
    usedAt: Date;
  }
) {
  const [token] = await db
    .update(loginLinkTokens)
    .set({
      status: "used",
      usedAt: input.usedAt,
    })
    .where(
      and(
        eq(loginLinkTokens.token, input.token),
        eq(loginLinkTokens.status, "active"),
        isNull(loginLinkTokens.usedAt),
        gt(loginLinkTokens.expiresAt, input.now)
      )
    )
    .returning();

  return token ?? null;
}

export async function revokeLoginLinkToken(db: DatabaseClient, token: string) {
  await db
    .update(loginLinkTokens)
    .set({
      status: "revoked",
    })
    .where(eq(loginLinkTokens.token, token));
}

export async function createSession(db: DatabaseClient, session: typeof sessions.$inferInsert) {
  await db.insert(sessions).values(session);
}

export async function findActiveSessionById(db: DatabaseClient, sessionId: string, now: Date) {
  const [row] = await db
    .select({
      session: sessions,
      user: userAccounts,
    })
    .from(sessions)
    .innerJoin(userAccounts, eq(sessions.userId, userAccounts.userId))
    .where(
      and(
        eq(sessions.sessionId, sessionId),
        eq(userAccounts.isActive, true),
        gt(sessions.expiresAt, now),
        isNull(sessions.revokedAt)
      )
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return row satisfies SessionWithUserRecord;
}

export async function touchSession(
  db: DatabaseClient,
  input: {
    sessionId: string;
    lastSeenAt: Date;
    expiresAt: Date;
  }
) {
  await db
    .update(sessions)
    .set({
      expiresAt: input.expiresAt,
      lastSeenAt: input.lastSeenAt,
    })
    .where(and(eq(sessions.sessionId, input.sessionId), isNull(sessions.revokedAt)));
}

export async function revokeSession(db: DatabaseClient, sessionId: string, revokedAt: Date) {
  await db
    .update(sessions)
    .set({
      revokedAt,
    })
    .where(eq(sessions.sessionId, sessionId));
}

export async function markUserLoggedIn(db: DatabaseClient, userId: string, lastLoginAt: Date) {
  await db
    .update(userAccounts)
    .set({
      lastLoginAt,
    })
    .where(eq(userAccounts.userId, userId));
}
