import { createSession, sessions } from "@injurysub/db";
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySessionCookie, createWebSession, resolveSession, revokeCurrentSession } from "./auth";
import { insertInventedUser, insertSession, readSession, webDbTest } from "./test-support";

const now = new Date("2026-11-03T12:00:00.000Z");
const hour = 3_600_000;
const day = 24 * hour;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("web sessions", () => {
  webDbTest(
    "stores a new session by the hash of its token, and finds it by the token",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db);

      const { sessionId } = await createWebSession({ userId, ipAddress: null, userAgent: null });

      const stored = await db.select().from(sessions);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.sessionId).toMatch(/^[0-9a-f]{64}$/);
      expect(stored[0]?.sessionId).not.toBe(sessionId);
      expect((await resolveSession(sessionId, new Date()))?.user.userId).toBe(userId);
    }
  );

  webDbTest("doesn't find a session stored under its raw token", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db);
    await createSession(db, {
      sessionId: "a-raw-token-from-before-hashing",
      userId,
      expiresAt: new Date(now.getTime() + 10 * day),
    });

    expect(await resolveSession("a-raw-token-from-before-hashing", now)).toBeNull();
  });

  webDbTest("renews a session last seen 25 hours ago to 90 days from now", async ({ database }) => {
    const { db } = database.connection;
    const token = await insertSession(db, await insertInventedUser(db), now, {
      lastSeenAt: new Date(now.getTime() - 25 * hour),
    });

    expect(await resolveSession(token, now)).not.toBeNull();

    expect(await readSession(db, token)).toMatchObject({
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 90 * day),
    });
  });

  webDbTest("leaves a session last seen 23 hours ago as it was", async ({ database }) => {
    const { db } = database.connection;
    const lastSeenAt = new Date(now.getTime() - 23 * hour);
    const expiresAt = new Date(now.getTime() + 10 * day);
    const token = await insertSession(db, await insertInventedUser(db), now, {
      lastSeenAt,
      expiresAt,
    });

    expect(await resolveSession(token, now)).not.toBeNull();

    expect(await readSession(db, token)).toMatchObject({ lastSeenAt, expiresAt });
  });

  webDbTest("refuses a revoked session, and doesn't renew it", async ({ database }) => {
    const { db } = database.connection;
    const lastSeenAt = new Date(now.getTime() - 25 * hour);
    const expiresAt = new Date(now.getTime() + 10 * day);
    const token = await insertSession(db, await insertInventedUser(db), now, {
      lastSeenAt,
      expiresAt,
      revokedAt: new Date(now.getTime() - hour),
    });

    expect(await resolveSession(token, now)).toBeNull();

    expect(await readSession(db, token)).toMatchObject({ lastSeenAt, expiresAt });
  });

  webDbTest(
    "refuses a session whose account is disabled, and doesn't renew it",
    async ({ database }) => {
      const { db } = database.connection;
      const lastSeenAt = new Date(now.getTime() - 25 * hour);
      const expiresAt = new Date(now.getTime() + 10 * day);
      const token = await insertSession(
        db,
        await insertInventedUser(db, { isActive: false }),
        now,
        {
          lastSeenAt,
          expiresAt,
        }
      );

      expect(await resolveSession(token, now)).toBeNull();

      expect(await readSession(db, token)).toMatchObject({ lastSeenAt, expiresAt });
    }
  );

  webDbTest("refuses a session whose expiry is now", async ({ database }) => {
    const { db } = database.connection;
    const token = await insertSession(db, await insertInventedUser(db), now, { expiresAt: now });

    expect(await resolveSession(token, now)).toBeNull();
  });

  webDbTest("revokes only the session whose token it's given", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db);
    const thisBrowser = await insertSession(db, userId, now);
    const otherBrowser = await insertSession(db, userId, now);

    await revokeCurrentSession(thisBrowser);

    expect((await readSession(db, thisBrowser))?.revokedAt).not.toBeNull();
    expect(await resolveSession(otherBrowser, now)).not.toBeNull();
  });

  webDbTest("still finds a session after SESSION_SECRET changes", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db);
    vi.stubEnv("SESSION_SECRET", "the-first-secret-for-this-test-0001");
    const { sessionId } = await createWebSession({ userId, ipAddress: null, userAgent: null });

    vi.stubEnv("SESSION_SECRET", "the-second-secret-for-this-test-002");

    expect((await resolveSession(sessionId, new Date()))?.user.userId).toBe(userId);
  });
});

describe("applySessionCookie", () => {
  // The browser reads these attributes from the Set-Cookie header.
  it("sets the session cookie for 400 days, HttpOnly, SameSite=Lax, on every path", () => {
    const response = NextResponse.json({});

    applySessionCookie(response, { sessionId: "the-raw-token", now });

    const header = response.headers.get("set-cookie") ?? "";
    const expires = new Date(now.getTime() + 400 * day).toUTCString();
    expect(header).toContain("injurysub_session=the-raw-token");
    expect(header).toContain(`Expires=${expires}`);
    expect(header).toContain("HttpOnly");
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure");
  });

  it("marks the session cookie Secure under NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    // A production run on this machine, so the development defaults stand.
    vi.stubEnv("DEPLOYMENT_MODE", "local");
    const response = NextResponse.json({});

    applySessionCookie(response, { sessionId: "the-raw-token", now });

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
