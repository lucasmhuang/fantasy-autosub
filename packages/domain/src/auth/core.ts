import { createHash } from "node:crypto";
import { z } from "zod";

export const sessionCookieName = "injurysub_session";

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

const emailAddressSchema = z.string().email();

// Sign-in's address check. The accounts file uses it too, so it accepts exactly what sign-in does.
export function parseEmailAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = normalizeEmailAddress(raw);
  return emailAddressSchema.safeParse(email).success ? email : null;
}

export function createSessionExpiresAt(now: Date, ttlDays: number) {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60_000);
}

export function isSessionActive(expiresAt: Date, revokedAt: Date | null, now: Date) {
  return revokedAt === null && expiresAt.getTime() > now.getTime();
}

// A session in use renews at most once a day.
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60_000;

// Browsers cap a cookie's lifetime at 400 days (RFC 6265bis); the database decides validity.
export const SESSION_COOKIE_MAX_AGE_DAYS = 400;

// The database stores this hash, never the token the cookie carries.
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function shouldRenewSession(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > SESSION_RENEW_AFTER_MS;
}

// Browsers send Origin on every form POST; a missing or "null" one is refused.
export function isSameOriginRequest(originHeader: string | null, appBaseUrl: string): boolean {
  return originHeader !== null && originHeader === new URL(appBaseUrl).origin;
}

// Destinations are resolved against a stand-in origin: any path that resolves elsewhere is off-site.
const redirectCheckOrigin = "http://redirect-check.invalid";

export function resolveSafeRedirectPath(redirectPath: unknown) {
  if (typeof redirectPath !== "string" || !/^\/[\x20-\x7e]*$/.test(redirectPath)) {
    return "/app";
  }

  // A leading "//" or "/\" names a host, and naming the stand-in host itself would pass the origin check.
  if (/^\/[/\\]/.test(redirectPath)) {
    return "/app";
  }

  if (!URL.canParse(redirectPath, redirectCheckOrigin)) {
    return "/app";
  }

  if (new URL(redirectPath, redirectCheckOrigin).origin !== redirectCheckOrigin) {
    return "/app";
  }

  return redirectPath;
}

// Anyone with a team starts on their team page, the commissioner included (behaviors D17); only
// a commissioner without a team starts on the requests page.
export function getDefaultSignedInPath(role: "manager" | "commissioner", teamId: number | null) {
  return role === "commissioner" && teamId === null ? "/commish/requests" : "/app";
}
