import { consumeLoginLinkToken, findActiveUserAccountById } from "@injurysub/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applySessionCookie,
  createWebSession,
  getSafePostLoginPath,
} from "../../../../../lib/server/auth";
import { getWebDatabaseConnection } from "../../../../../lib/server/db";

const consumeParamsSchema = z.object({
  token: z.string().min(1),
});

function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  const params = consumeParamsSchema.parse(await context.params);
  const now = new Date();
  const { db } = getWebDatabaseConnection();
  const consumedToken = await consumeLoginLinkToken(db, {
    now,
    token: params.token,
    usedAt: now,
  });

  if (!consumedToken) {
    return NextResponse.redirect(new URL(`/auth/magic/${params.token}`, request.url), {
      status: 303,
    });
  }

  const user = await findActiveUserAccountById(db, consumedToken.userId);

  if (!user) {
    return NextResponse.redirect(new URL("/login?status=unknown_email", request.url), {
      status: 303,
    });
  }

  const session = await createWebSession({
    ipAddress: getRequestIpAddress(request),
    userAgent: request.headers.get("user-agent"),
    userId: user.userId,
  });

  const response = NextResponse.redirect(
    new URL(
      getSafePostLoginPath({
        redirectPath: consumedToken.redirectPath,
        role: user.role,
      }),
      request.url
    ),
    {
      status: 303,
    }
  );

  applySessionCookie(response, session);

  return response;
}
