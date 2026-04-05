import { loadServerEnv } from "@injurysub/config";
import {
  createLoginLinkToken,
  findActiveUserAccountByEmail,
  revokeLoginLinkToken,
} from "@injurysub/db";
import {
  createMagicLinkExpiresAt,
  normalizeEmailAddress,
  resolveSafeRedirectPath,
} from "@injurysub/domain";
import { buildMagicLinkEmail } from "@injurysub/email";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildMagicLinkUrl, createOpaqueAuthToken } from "../../../lib/server/auth";
import { getWebDatabaseConnection } from "../../../lib/server/db";
import { getWebEmailClient } from "../../../lib/server/email";

const requestLinkSchema = z.object({
  email: z.string().email(),
  redirectPath: z.string().optional(),
});

function createLoginRedirect(status: string, email?: string, redirectPath?: string) {
  const location = new URL("/login", loadServerEnv().APP_BASE_URL);
  location.searchParams.set("status", status);

  if (email) {
    location.searchParams.set("email", email);
  }

  if (redirectPath) {
    location.searchParams.set("redirect", redirectPath);
  }

  return NextResponse.redirect(location, {
    status: 303,
  });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = requestLinkSchema.safeParse({
    email: formData.get("email"),
    redirectPath: formData.get("redirectPath") || undefined,
  });

  if (!parsed.success) {
    return createLoginRedirect("invalid_email");
  }

  const email = normalizeEmailAddress(parsed.data.email);
  const redirectPath = resolveSafeRedirectPath(parsed.data.redirectPath);
  const { db } = getWebDatabaseConnection();
  const user = await findActiveUserAccountByEmail(db, email);

  if (!user) {
    return createLoginRedirect("unknown_email", email, redirectPath);
  }

  const env = loadServerEnv();
  const now = new Date();
  const token = createOpaqueAuthToken();

  await createLoginLinkToken(db, {
    token,
    userId: user.userId,
    redirectPath,
    status: "active",
    createdAt: now,
    expiresAt: createMagicLinkExpiresAt(now, env.MAGIC_LINK_TTL_MINUTES),
    usedAt: null,
  });

  try {
    await getWebEmailClient().send(
      buildMagicLinkEmail({
        email: user.email,
        magicLinkUrl: buildMagicLinkUrl(token),
      })
    );
  } catch {
    await revokeLoginLinkToken(db, token);
    return createLoginRedirect("send_failed", user.email, redirectPath);
  }

  return createLoginRedirect("email_sent", user.email, redirectPath);
}
