import { randomUUID } from "node:crypto";
import { loadServerEnv } from "@injurysub/config";
import {
  expireSignInCode,
  findActiveUserAccountByEmail,
  insertSignInCode,
  listSignInCodeTimesSince,
  lockActiveUserAccount,
} from "@injurysub/db";
import {
  createSignInCodeExpiresAt,
  decideSignInCodeSend,
  hashSignInCode,
  parseEmailAddress,
  resolveSafeRedirectPath,
  SIGN_IN_CODE_SEND_WINDOWS,
} from "@injurysub/domain";
import { buildSignInCodeEmail, EmailError } from "@injurysub/email";
import { createSignInCode } from "./auth";
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

// Sent outside the transaction, so a slow provider holds no lock. A failed send expires its code,
// which still counts toward the limit.
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
    await expireSignInCode(getWebDatabaseConnection().db, {
      codeId: input.codeId,
      now: new Date(),
    });
    getWebLogger().error("web.auth.sign_in_code_send_failed", error, { userId: input.userId });
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
