import { loadServerEnv } from "@injurysub/config";
import { resolveSafeRedirectPath } from "@injurysub/domain";
import { NextResponse } from "next/server";
import {
  applySessionCookie,
  getSafePostLoginPath,
  refuseCrossSitePost,
} from "../../../lib/server/auth";
import {
  loginLocation,
  type SignInCodeVerification,
  verifySignInCode,
} from "../../../lib/server/sign-in";

export async function POST(request: Request) {
  const refusal = refuseCrossSitePost(request);

  if (refusal) {
    return refusal;
  }

  const form = await request.formData();
  const now = new Date();
  const result = await verifySignInCode({
    rawEmail: form.get("email"),
    rawCode: form.get("code"),
    now,
    userAgent: request.headers.get("user-agent"),
    ipAddress: getRequestIpAddress(request),
  });

  if (result.status !== "signed_in") {
    // The page's own destination, so "Send a new code" keeps it. Signing in uses the code row's.
    const pageRedirect = resolveSafeRedirectPath(form.get("redirectPath"));
    return NextResponse.redirect(failureLocation(result, pageRedirect), { status: 303 });
  }

  const destination = getSafePostLoginPath({
    redirectPath: result.redirectPath,
    role: result.role,
    teamId: result.teamId,
  });
  const response = NextResponse.redirect(new URL(destination, loadServerEnv().APP_BASE_URL), {
    status: 303,
  });
  applySessionCookie(response, { sessionId: result.sessionId, now });

  return response;
}

// A refused address goes back to the first step; a refused code stays on the code step.
function failureLocation(
  result: Exclude<SignInCodeVerification, { status: "signed_in" }>,
  redirect: string
) {
  if (result.status === "invalid_email") {
    return loginLocation({ status: result.status, redirect });
  }
  if (result.status === "unknown_email") {
    return loginLocation({ status: result.status, email: result.email, redirect });
  }
  return loginLocation({
    step: "code",
    status: result.status,
    email: result.email,
    redirect,
    tries: result.status === "wrong_code" ? result.triesLeft : undefined,
  });
}

// The client's address as the host's proxy reports it.
function getRequestIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}
