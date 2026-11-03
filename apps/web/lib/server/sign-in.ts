import { randomUUID } from "node:crypto";
import { loadServerEnv } from "@injurysub/config";
import {
  findActiveUserAccountByEmail,
  findNewestSignInCode,
  insertSignInCode,
  listSignInCodeTimesSince,
  lockActiveUserAccount,
  markSignInCodeSendFailed,
  markSignInCodeUsed,
  type SignInCodeRecord,
  spendSignInCodeAttempt,
  type UserAccountRecord,
} from "@injurysub/db";
import {
  createSignInCodeExpiresAt,
  decideSignInCodeSend,
  hashSignInCode,
  normalizeSubmittedCode,
  parseEmailAddress,
  resolveSafeRedirectPath,
  SIGN_IN_CODE_MAX_ATTEMPTS,
  SIGN_IN_CODE_SEND_WINDOWS,
  signInCodeHashesMatch,
  type UserRole,
} from "@injurysub/domain";
import { buildSignInCodeEmail, EmailError } from "@injurysub/email";
import { createSignInCode, createWebSession } from "./auth";
import { getWebDatabaseConnection } from "./db";
import { getWebEmailClient } from "./email";
import { getWebLogger } from "./logger";

// How far back the send limit looks: its longest window.
const SEND_LIMIT_LOOKBACK_MS =
  Math.max(...SIGN_IN_CODE_SEND_WINDOWS.map((window) => window.minutes)) * 60_000;

export type SignInCodeRequest = { redirectPath: string } & (
  | { status: "invalid_email" }
  | { status: "unknown_email" | "send_failed" | "code_sent"; email: string }
  | { status: "too_many_codes"; email: string; retryAfterMinutes: number }
);

export type SignInCodeVerification =
  | { status: "invalid_email" }
  | { status: "unknown_email"; email: string }
  | {
      status: "invalid_code" | "code_expired" | "too_many_tries";
      email: string;
      redirectPath?: string;
    }
  | { status: "wrong_code"; email: string; triesLeft: number; redirectPath: string }
  | { status: "signed_in"; sessionId: string; redirectPath: string; role: UserRole };

// Checks a typed code against the newest code sent to the address, spending one of its tries
// first, so simultaneous guesses can't spend more than the limit. An older code is a wrong try
// against the newest. The right code signs this browser in, once.
type VerificationInput = {
  rawEmail: unknown;
  rawCode: unknown;
  now: Date;
  userAgent: string | null;
  ipAddress: string | null;
};

export async function verifySignInCode(input: VerificationInput): Promise<SignInCodeVerification> {
  const email = parseEmailAddress(input.rawEmail);
  if (email === null) return { status: "invalid_email" };
  const code = normalizeSubmittedCode(input.rawCode);
  if (code === null) return { status: "invalid_code", email };

  const user = await findActiveUserAccountByEmail(getWebDatabaseConnection().db, email);
  if (!user) return { status: "unknown_email", email };

  return checkCodeThenSignIn({ ...input, user, email, code });
}

async function checkCodeThenSignIn(
  input: VerificationInput & { user: UserAccountRecord; email: string; code: string }
): Promise<SignInCodeVerification> {
  const { db } = getWebDatabaseConnection();
  const { user, email, now } = input;
  const newest = await findNewestSignInCode(db, user.userId);
  if (!newest) return { status: "code_expired", email };

  const maxAttempts = SIGN_IN_CODE_MAX_ATTEMPTS;
  const spent = await spendSignInCodeAttempt(db, { codeId: newest.codeId, now, maxAttempts });
  if (!spent) return { status: refusalOf(newest, now), email, redirectPath: newest.redirectPath };

  const secret = loadServerEnv().SESSION_SECRET;
  const typedHash = hashSignInCode({ secret, userId: user.userId, code: input.code });
  if (!signInCodeHashesMatch(spent.codeHash, typedHash))
    return wrongCode(user.userId, email, spent);

  if (!(await markSignInCodeUsed(db, { codeId: spent.codeId, now }))) {
    return { status: "code_expired", email, redirectPath: spent.redirectPath };
  }
  const { userAgent, ipAddress } = input;
  const { sessionId } = await createWebSession({ userId: user.userId, userAgent, ipAddress });
  return { status: "signed_in", sessionId, redirectPath: spent.redirectPath, role: user.role };
}

// Why a code took no try: out of tries, or used or expired.
function refusalOf(code: SignInCodeRecord, now: Date): "too_many_tries" | "code_expired" {
  const live = code.usedAt === null && code.expiresAt.getTime() > now.getTime();
  return live && code.attempts >= SIGN_IN_CODE_MAX_ATTEMPTS ? "too_many_tries" : "code_expired";
}

// The try that used the last one locks the code: it answers too_many_tries, never 0 tries left.
function wrongCode(userId: string, email: string, spent: SignInCodeRecord): SignInCodeVerification {
  const triesLeft = SIGN_IN_CODE_MAX_ATTEMPTS - spent.attempts;
  if (triesLeft > 0) {
    return { status: "wrong_code", email, triesLeft, redirectPath: spent.redirectPath };
  }
  getWebLogger().warn("web.auth.sign_in_code_locked", { userId });
  return { status: "too_many_tries", email, redirectPath: spent.redirectPath };
}

type CodeReservation =
  | { status: "reserved"; codeId: string; code: string }
  | { status: "account_disabled" }
  | { status: "limited"; retryAfterMinutes: number };

// Emails a sign-in code to an active account's stored address, unless the address has had too
// many lately. The code is stored only as its hash, with where to go once signed in.
export async function requestSignInCode(input: {
  rawEmail: unknown;
  rawRedirectPath: unknown;
  now: Date;
}): Promise<SignInCodeRequest> {
  const redirectPath = resolveSafeRedirectPath(input.rawRedirectPath);
  const email = parseEmailAddress(input.rawEmail);
  if (email === null) return { status: "invalid_email", redirectPath };

  const user = await findActiveUserAccountByEmail(getWebDatabaseConnection().db, email);
  if (!user) return { status: "unknown_email", email, redirectPath };

  const reservation = await reserveSignInCode({
    userId: user.userId,
    redirectPath,
    now: input.now,
  });
  if (reservation.status === "account_disabled") {
    return { status: "unknown_email", email, redirectPath };
  }
  if (reservation.status === "limited") {
    getWebLogger().warn("web.auth.sign_in_code_limited", {
      userId: user.userId,
      retryAfterMinutes: reservation.retryAfterMinutes,
    });
    const { retryAfterMinutes } = reservation;
    return { status: "too_many_codes", email: user.email, retryAfterMinutes, redirectPath };
  }

  const sent = await sendSignInCode({ userId: user.userId, email: user.email, ...reservation });
  return { status: sent ? "code_sent" : "send_failed", email: user.email, redirectPath };
}

// Under a lock on the user's row, so one address's requests are counted one at a time.
async function reserveSignInCode(input: {
  userId: string;
  redirectPath: string;
  now: Date;
}): Promise<CodeReservation> {
  const env = loadServerEnv();
  const { userId, redirectPath, now } = input;
  return getWebDatabaseConnection().transaction(async (tx) => {
    if (!(await lockActiveUserAccount(tx, userId))) return { status: "account_disabled" };

    const since = new Date(now.getTime() - SEND_LIMIT_LOOKBACK_MS);
    const decision = decideSignInCodeSend(await listSignInCodeTimesSince(tx, userId, since), now);
    if (!decision.allowed)
      return { status: "limited", retryAfterMinutes: decision.retryAfterMinutes };

    const code = createSignInCode();
    const codeId = randomUUID();
    await insertSignInCode(tx, {
      codeId,
      userId,
      codeHash: hashSignInCode({ secret: env.SESSION_SECRET, userId, code }),
      redirectPath,
      createdAt: now,
      expiresAt: createSignInCodeExpiresAt(now, env.SIGN_IN_CODE_TTL_MINUTES),
    });
    return { status: "reserved", codeId, code };
  });
}

// Sent outside the transaction, so a slow provider holds no lock. A failed send's code still counts
// toward the limit, but the code sent before it stays the one to enter.
async function sendSignInCode(input: {
  userId: string;
  email: string;
  codeId: string;
  code: string;
}): Promise<boolean> {
  const ttlMinutes = loadServerEnv().SIGN_IN_CODE_TTL_MINUTES;
  try {
    await getWebEmailClient().send(
      buildSignInCodeEmail({ to: input.email, code: input.code, ttlMinutes })
    );
    return true;
  } catch (error) {
    if (!(error instanceof EmailError)) throw error;
    // Logged first, so the failure is on record even if recording it in the database fails.
    getWebLogger().error("web.auth.sign_in_code_send_failed", error, { userId: input.userId });
    await markSignInCodeSendFailed(getWebDatabaseConnection().db, {
      codeId: input.codeId,
      now: new Date(),
    });
    return false;
  }
}

// The login page's address after a sign-in form. The page reads these parameters back by name:
// step, status, email, redirect, retry and tries, in that order.
export function loginLocation(params: {
  step?: "code" | undefined;
  status: string;
  email?: string | undefined;
  redirect?: string | undefined;
  retry?: number | undefined;
  tries?: number | undefined;
}): URL {
  const location = new URL("/login", loadServerEnv().APP_BASE_URL);
  const entries: [string, string | number | undefined][] = [
    ["step", params.step],
    ["status", params.status],
    ["email", params.email],
    ["redirect", params.redirect],
    ["retry", params.retry],
    ["tries", params.tries],
  ];
  for (const [name, value] of entries) {
    if (value !== undefined) location.searchParams.set(name, String(value));
  }
  return location;
}
