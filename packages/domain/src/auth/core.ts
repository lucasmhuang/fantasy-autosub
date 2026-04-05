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

export function resolveSafeRedirectPath(redirectPath: string | null | undefined) {
  if (!redirectPath) {
    return "/app";
  }

  if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
    return "/app";
  }

  return redirectPath;
}

export function getDefaultSignedInPath(role: "manager" | "commissioner") {
  return role === "commissioner" ? "/commish/requests" : "/app";
}
