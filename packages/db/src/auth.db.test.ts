import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { createSession, findActiveCommissioner, touchSession } from "./auth";
import { sessions, userAccounts } from "./schema";
import { dbTest } from "./test-support";

const now = new Date("2026-11-03T12:00:00.000Z");
const day = 24 * 3_600_000;

describe("touchSession", () => {
  // A renewal racing a sign-out must not bring the session back.
  dbTest("never renews a revoked session", async ({ database }) => {
    const { db } = database.connection;
    const userId = randomUUID();
    await db.insert(userAccounts).values({
      userId,
      email: `person-${userId}@example.test`,
      displayName: "Invented Person",
      role: "manager",
    });
    const sessionId = `hash-${randomUUID()}`;
    const lastSeenAt = new Date(now.getTime() - 2 * day);
    const expiresAt = new Date(now.getTime() + day);
    await createSession(db, {
      sessionId,
      userId,
      lastSeenAt,
      expiresAt,
      revokedAt: new Date(now.getTime() - 3_600_000),
    });

    await touchSession(db, {
      sessionId,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 90 * day),
    });

    const [row] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId));
    expect(row).toMatchObject({ lastSeenAt, expiresAt });
  });
});

describe("findActiveCommissioner", () => {
  dbTest("finds the active commissioner, never a disabled one, or null", async ({ database }) => {
    const { db } = database.connection;
    expect(await findActiveCommissioner(db)).toBeNull();
    const insert = async (isActive: boolean) => {
      const userId = randomUUID();
      await db.insert(userAccounts).values({
        userId,
        email: `person-${userId}@example.test`,
        teamId: 1,
        displayName: "Invented Person",
        role: "commissioner",
        isActive,
      });
      return userId;
    };
    await insert(false);
    const active = await insert(true);

    expect((await findActiveCommissioner(db))?.userId).toBe(active);
  });
});
