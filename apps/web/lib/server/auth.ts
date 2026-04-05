import { randomBytes } from "node:crypto";
import { loadServerEnv } from "@injurysub/config";
import {
  createSession as createSessionRecord,
  findActiveSessionById,
  markUserLoggedIn,
  revokeSession as revokeSessionRecord,
} from "@injurysub/db";
import {
  createSessionExpiresAt,
  getDefaultSignedInPath,
  resolveSafeRedirectPath,
  sessionCookieName,
} from "@injurysub/domain";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getWebDatabaseConnection } from "./db";

export type AuthenticatedSession = Awaited<ReturnType<typeof getCurrentAuthenticatedSession>>;

export function createOpaqueAuthToken(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

export function buildMagicLinkUrl(token: string) {
  const env = loadServerEnv();

  return new URL(`/auth/magic/${token}`, env.APP_BASE_URL).toString();
}

export function getSessionCookieName() {
  const env = loadServerEnv();

  return env.SESSION_COOKIE_NAME || sessionCookieName;
}

export function applySessionCookie(
  response: NextResponse,
  input: {
    expiresAt: Date;
    sessionId: string;
  }
) {
  const env = loadServerEnv();

  response.cookies.set({
    name: getSessionCookieName(),
    value: input.sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: input.expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  const env = loadServerEnv();

  response.cookies.set({
    name: getSessionCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function createWebSession(input: {
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
}) {
  const env = loadServerEnv();
  const now = new Date();
  const sessionId = createOpaqueAuthToken();
  const expiresAt = createSessionExpiresAt(now, env.SESSION_TTL_DAYS);
  const { db } = getWebDatabaseConnection();

  await createSessionRecord(db, {
    sessionId,
    userId: input.userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    revokedAt: null,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  await markUserLoggedIn(db, input.userId, now);

  return {
    expiresAt,
    sessionId,
  };
}

export async function getCurrentAuthenticatedSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(getSessionCookieName())?.value;

  if (!sessionId) {
    return null;
  }

  const { db } = getWebDatabaseConnection();
  return findActiveSessionById(db, sessionId, new Date());
}

export async function revokeCurrentSession(sessionId: string) {
  const { db } = getWebDatabaseConnection();

  await revokeSessionRecord(db, sessionId, new Date());
}

export function getSafePostLoginPath(input: {
  redirectPath?: string | null;
  role: "manager" | "commissioner";
}) {
  const safePath = resolveSafeRedirectPath(input.redirectPath);

  if (input.role !== "commissioner" && safePath.startsWith("/commish")) {
    return getDefaultSignedInPath(input.role);
  }

  if (safePath === "/app" && input.role === "commissioner") {
    return getDefaultSignedInPath(input.role);
  }

  return safePath;
}
