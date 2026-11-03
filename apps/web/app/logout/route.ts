import { loadServerEnv } from "@injurysub/config";
import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionCookieName,
  refuseCrossSitePost,
  revokeCurrentSession,
} from "../../lib/server/auth";

export async function POST(request: NextRequest) {
  const refusal = refuseCrossSitePost(request);

  if (refusal) {
    return refusal;
  }

  const rawToken = request.cookies.get(getSessionCookieName())?.value;

  if (rawToken) {
    await revokeCurrentSession(rawToken);
  }

  // On the app's own address: behind the host's proxy, request.url is the server's internal one.
  const response = NextResponse.redirect(
    new URL("/login?status=signed_out", loadServerEnv().APP_BASE_URL),
    { status: 303 }
  );

  clearSessionCookie(response);

  return response;
}
