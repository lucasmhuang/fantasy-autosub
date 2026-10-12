export const sessionCookieName = "injurysub_session";

export type MagicLinkStatus = "active" | "used" | "expired" | "revoked";

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase();
}

export function createMagicLinkExpiresAt(now: Date, ttlMinutes: number) {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export function createSessionExpiresAt(now: Date, ttlDays: number) {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60_000);
}

export function isMagicLinkActive(
  status: MagicLinkStatus,
  expiresAt: Date,
  usedAt: Date | null,
  now: Date
) {
  return status === "active" && usedAt === null && expiresAt.getTime() > now.getTime();
}

export function isSessionActive(expiresAt: Date, revokedAt: Date | null, now: Date) {
  return revokedAt === null && expiresAt.getTime() > now.getTime();
}

// Destinations are resolved against a stand-in origin: any path that resolves elsewhere is off-site.
const redirectCheckOrigin = "http://redirect-check.invalid";

export function resolveSafeRedirectPath(redirectPath: unknown) {
  if (typeof redirectPath !== "string" || !/^\/[\x20-\x7e]*$/.test(redirectPath)) {
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

export function getDefaultSignedInPath(role: "manager" | "commissioner") {
  return role === "commissioner" ? "/commish/requests" : "/app";
}
