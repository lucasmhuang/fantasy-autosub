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
      step: staysOnCodeStep(result.status, form.get("step") === "code") ? "code" : undefined,
      status: result.status,
      email: "email" in result ? result.email : undefined,
      redirect: result.redirectPath,
      retry: result.status === "too_many_codes" ? result.retryAfterMinutes : undefined,
      until: "codeWorksUntil" in result ? result.codeWorksUntil : undefined,
    }),
    { status: 303 }
  );
}

// Too many codes keeps the person on the code step: the newest code may still work. So does a
// resend from the code step that failed (FM-SIGNIN-10): the code they already have still works.
function staysOnCodeStep(status: string, fromCodeStep: boolean): boolean {
  if (status === "code_sent" || status === "too_many_codes") return true;
  return fromCodeStep && (status === "send_failed" || status === "unavailable");
}
