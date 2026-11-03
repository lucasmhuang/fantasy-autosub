import { NextResponse } from "next/server";
import { refuseCrossSitePost } from "../../../lib/server/auth";
import { loginLocation, requestSignInCode } from "../../../lib/server/sign-in";

export async function POST(request: Request) {
  const refusal = refuseCrossSitePost(request);

  if (refusal) {
    return refusal;
  }

  const form = await request.formData();
  const result = await requestSignInCode({
    rawEmail: form.get("email"),
    rawRedirectPath: form.get("redirectPath"),
    now: new Date(),
  });

  return NextResponse.redirect(
    loginLocation({
      // Too many codes keeps the person on the code step: the newest code may still work.
      step:
        result.status === "code_sent" || result.status === "too_many_codes" ? "code" : undefined,
      status: result.status,
      email: "email" in result ? result.email : undefined,
      redirect: result.redirectPath,
      retry: result.status === "too_many_codes" ? result.retryAfterMinutes : undefined,
    }),
    { status: 303 }
  );
}
