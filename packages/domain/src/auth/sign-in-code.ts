import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGN_IN_CODE_MAX_ATTEMPTS = 5;

// An address gets at most `max` codes in any `minutes`-long window.
export const SIGN_IN_CODE_SEND_WINDOWS = [
  { minutes: 15, max: 3 },
  { minutes: 24 * 60, max: 10 },
] as const;

export type SignInCodeSendDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMinutes: number };

export function formatSignInCode(value: number): string {
  return String(value).padStart(6, "0");
}

// People type or paste a code with spaces ("123 456"), so whitespace is dropped before the check.
export function normalizeSubmittedCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

// Keyed, so a leaked table can't be reversed by trying all 10^6 codes. The user id ties a code to
// the account it was sent to.
export function hashSignInCode(input: { secret: string; userId: string; code: string }): string {
  return createHmac("sha256", input.secret).update(`${input.userId}:${input.code}`).digest("hex");
}

export function signInCodeHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSignInCodeExpiresAt(now: Date, ttlMinutes: number): Date {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

// Refused while any window already holds its maximum, until enough of its sends age out; with
// both full, the longer wait. A send exactly a window's length ago is outside that window.
export function decideSignInCodeSend(sentAt: Date[], now: Date): SignInCodeSendDecision {
  const sentTimes = sentAt.map((time) => time.getTime());
  const waits = SIGN_IN_CODE_SEND_WINDOWS.map((window) =>
    windowWaitMs(sentTimes, window, now.getTime())
  );
  const retryAfterMs = Math.max(0, ...waits);
  if (retryAfterMs === 0) return { allowed: true };
  return { allowed: false, retryAfterMinutes: Math.ceil(retryAfterMs / 60_000) };
}

function windowWaitMs(
  sentTimes: number[],
  window: { minutes: number; max: number },
  nowMs: number
): number {
  const windowMs = window.minutes * 60_000;
  const inWindow = sentTimes.filter((time) => time > nowMs - windowMs).sort((a, b) => a - b);
  // The send whose ageing out takes the window below its maximum. Below the maximum the index is
  // negative, so there's none, and no wait.
  const freeingSend = inWindow[inWindow.length - window.max];
  return freeingSend === undefined ? 0 : freeingSend + windowMs - nowMs;
}
