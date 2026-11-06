import { randomBytes, randomInt } from "node:crypto";
import { loadServerEnv } from "@injurysub/config";
import {
  createSession as createSessionRecord,
  type DatabaseExecutor,
  findActiveSessionById,
  markUserLoggedIn,
  revokeSession as revokeSessionRecord,
  touchSession,
} from "@injurysub/db";
import {
  createSessionExpiresAt,
  formatSignInCode,
  getDefaultSignedInPath,
  hashSessionToken,
  isSameOriginRequest,
  resolveSafeRedirectPath,
  SESSION_COOKIE_MAX_AGE_DAYS,
  sessionCookieName,
  shouldRenewSession,
} from "@injurysub/domain";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";

export type AuthenticatedSession = Awaited<ReturnType<typeof getCurrentAuthenticatedSession>>;

export function createOpaqueAuthToken(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

// Six random digits, leading zeros kept.
export function createSignInCode() {
  return formatSignInCode(randomInt(0, 1_000_000));
}

export function getSessionCookieName() {
  const env = loadServerEnv();

  return env.SESSION_COOKIE_NAME || sessionCookieName;
}

// Set once, at sign-in, for as long as browsers keep a cookie. The database decides whether the
// session is still valid, and renews it as it's used. Set it only on a top-level navigation's
// response: Safari caps the lifetime of a cookie set on a fetch.
export function applySessionCookie(
  response: NextResponse,
  input: {
    now: Date;
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
    expires: createSessionExpiresAt(input.now, SESSION_COOKIE_MAX_AGE_DAYS),
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

// `db` lets a caller create the session inside its own transaction.
export async function createWebSession(input: {
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  db?: DatabaseExecutor;
}) {
  const env = loadServerEnv();
  const now = new Date();
  const sessionId = createOpaqueAuthToken();
  const expiresAt = createSessionExpiresAt(now, env.SESSION_TTL_DAYS);
  const db = input.db ?? getWebDatabaseConnection().db;

  await createSessionRecord(db, {
    sessionId: hashSessionToken(sessionId),
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

// The active session the cookie's token names, renewed to SESSION_TTL_DAYS from now when it was
// last seen more than a day ago. A revoked or expired session, or a disabled account's, is never
// found, so never renewed.
export async function resolveSession(rawToken: string, now: Date) {
  const env = loadServerEnv();
  const { db } = getWebDatabaseConnection();
  const sessionId = hashSessionToken(rawToken);
  const found = await findActiveSessionById(db, sessionId, now);

  if (!found || !shouldRenewSession(found.session.lastSeenAt, now)) {
    return found;
  }

  const expiresAt = createSessionExpiresAt(now, env.SESSION_TTL_DAYS);
  await touchSession(db, { sessionId, lastSeenAt: now, expiresAt });

  return { ...found, session: { ...found.session, lastSeenAt: now, expiresAt } };
}

export async function getCurrentAuthenticatedSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(getSessionCookieName())?.value;

  if (!rawToken) {
    return null;
  }

  return resolveSession(rawToken, new Date());
}

export async function revokeCurrentSession(rawToken: string) {
  const { db } = getWebDatabaseConnection();

  await revokeSessionRecord(db, hashSessionToken(rawToken), new Date());
}

// Every form POST must come from the app's own pages: a 403 for anything else, including a
// missing Origin, so another site can't sign someone in, or out. Null when the request may go on.
export function refuseCrossSitePost(request: Request): NextResponse | null {
  if (isSameOriginRequest(request.headers.get("origin"), loadServerEnv().APP_BASE_URL)) {
    return null;
  }

  getWebLogger().warn("web.auth.cross_site_refused", { path: new URL(request.url).pathname });

  return new NextResponse("This form must be sent from InjurySub.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function getSafePostLoginPath(input: {
  redirectPath?: string | null;
  role: "manager" | "commissioner";
  teamId: number | null;
}) {
  const safePath = resolveSafeRedirectPath(input.redirectPath);

  if (input.role !== "commissioner" && safePath.startsWith("/commish")) {
    return getDefaultSignedInPath(input.role, input.teamId);
  }

  if (safePath === "/app") {
    return getDefaultSignedInPath(input.role, input.teamId);
  }

  return safePath;
}
