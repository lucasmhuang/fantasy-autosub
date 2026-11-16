import { loadServerEnv } from "@injurysub/config";
import { parseEmailAddress, resolveSafeRedirectPath } from "@injurysub/domain";
import { redirect } from "next/navigation";
import { getCurrentAuthenticatedSession, getSafePostLoginPath } from "../../../lib/server/auth";
import { type LoginStep, LoginView } from "./login-view";
import { backNotice, renderStatusMessage } from "./status-messages";

// What the sign-in routes write into /login.
type LoginSearchParams = {
  step?: string;
  status?: string;
  email?: string;
  redirect?: string;
  retry?: string;
  tries?: string;
};

function wholeNumber(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

export default async function LoginPage(props: { searchParams: Promise<LoginSearchParams> }) {
  const session = await getCurrentAuthenticatedSession();
  const searchParams = await props.searchParams;
  const redirectPath = resolveSafeRedirectPath(searchParams.redirect);

  if (session) {
    redirect(
      getSafePostLoginPath({ redirectPath, role: session.user.role, teamId: session.user.teamId })
    );
  }

  // Shown on the page, so only when it's an address: a crafted link can't put other text there.
  const email = parseEmailAddress(searchParams.email);
  // The step lives in the address, so a reload, or iOS reopening the home-screen app, keeps it.
  const step: LoginStep =
    searchParams.step === "code" && email ? { kind: "code", email } : { kind: "email", email };
  const message =
    renderStatusMessage(searchParams.status ?? null, step.kind, {
      retryAfterMinutes: wholeNumber(searchParams.retry),
      triesLeft: wholeNumber(searchParams.tries),
    }) ?? (step.kind === "email" ? backNotice(redirectPath) : null);

  const env = loadServerEnv();
  return (
    <LoginView
      step={step}
      sender={env.EMAIL_FROM_ADDRESS}
      ttlMinutes={env.SIGN_IN_CODE_TTL_MINUTES}
      redirectPath={redirectPath}
      message={message}
    />
  );
}
