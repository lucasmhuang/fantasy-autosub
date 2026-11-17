import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import {
  createSession,
  findActiveCommissioner,
  findTeamManagerName,
  findUserDisplayName,
  touchSession,
} from "./auth";
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

async function insertPerson(
  db: Parameters<typeof findUserDisplayName>[0],
  person: { displayName: string; teamId: number | null; isActive: boolean }
) {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `person-${userId}@example.test`,
    role: "manager",
    ...person,
  });
  return userId;
}

describe("findUserDisplayName", () => {
  dbTest(
    "names an account, a disabled one too, and nobody for an unknown id",
    async ({ database }) => {
      const { db } = database.connection;
      const disabled = await insertPerson(db, {
        displayName: "Dana Invented",
        teamId: 3,
        isActive: false,
      });

      expect(await findUserDisplayName(db, disabled)).toBe("Dana Invented");
      expect(await findUserDisplayName(db, randomUUID())).toBeNull();
    }
  );
});

describe("findTeamManagerName", () => {
  dbTest("names the team's active account, never a disabled one", async ({ database }) => {
    const { db } = database.connection;
    await insertPerson(db, { displayName: "Old Manager", teamId: 4, isActive: false });
    await insertPerson(db, { displayName: "Priya Invented", teamId: 4, isActive: true });

    expect(await findTeamManagerName(db, 4)).toBe("Priya Invented");
    expect(await findTeamManagerName(db, 5)).toBeNull();
  });
});
