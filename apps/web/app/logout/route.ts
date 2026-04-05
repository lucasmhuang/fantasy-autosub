import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionCookieName,
  revokeCurrentSession,
} from "../../lib/server/auth";

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get(getSessionCookieName())?.value;

  if (sessionId) {
    await revokeCurrentSession(sessionId);
  }

  const response = NextResponse.redirect(new URL("/login?status=signed_out", request.url), {
    status: 303,
  });

  clearSessionCookie(response);

  return response;
}
