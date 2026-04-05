import { resolveSafeRedirectPath } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import { redirect } from "next/navigation";
import { Surface } from "../../../components/shell/site-shell";
import { getCurrentAuthenticatedSession, getSafePostLoginPath } from "../../../lib/server/auth";

function renderStatusMessage(status: string | null, email: string | null) {
  switch (status) {
    case "email_sent":
      return {
        body: `Check ${email ?? "your email"} for a sign-in link.`,
        tone: "success" as const,
      };
    case "unknown_email":
      return {
        body: "I don't recognize that email address. Ask your commissioner to add you.",
        tone: "danger" as const,
      };
    case "invalid_email":
      return {
        body: "Enter a valid email address to request a magic link.",
        tone: "danger" as const,
      };
    case "send_failed":
      return {
        body: "The sign-in email could not be sent. Try again in a moment.",
        tone: "danger" as const,
      };
    case "signed_out":
      return {
        body: "You have been signed out.",
        tone: "muted" as const,
      };
    default:
      return null;
  }
}

export default async function LoginPage(props: {
  searchParams: Promise<{
    email?: string;
    redirect?: string;
    status?: string;
  }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const searchParams = await props.searchParams;
  const requestedRedirect = resolveSafeRedirectPath(searchParams.redirect);

  if (session) {
    redirect(getSafePostLoginPath({ redirectPath: requestedRedirect, role: session.user.role }));
  }

  const status = renderStatusMessage(searchParams.status ?? null, searchParams.email ?? null);

  return (
    <main className="page-shell">
      <div className="page-inner flex min-h-[calc(100vh-3rem)] items-center justify-center">
        <Surface className="w-full max-w-xl rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Magic Link Sign-In</p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">
            Sign in with your league email.
          </h1>
          <p className="mt-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            Enter your pre-registered email and InjurySub will send a one-time sign-in link. The
            link lands on a confirmation page before it creates a session on this device.
          </p>

          {status ? (
            <div
              className="mt-6 rounded-2xl border px-4 py-3 text-sm leading-7"
              style={{
                borderColor:
                  status.tone === "success"
                    ? "rgba(136, 228, 159, 0.24)"
                    : status.tone === "danger"
                      ? "rgba(255, 134, 125, 0.24)"
                      : "rgba(255, 255, 255, 0.1)",
                color:
                  status.tone === "success"
                    ? "var(--success)"
                    : status.tone === "danger"
                      ? "var(--danger)"
                      : "var(--muted)",
              }}
            >
              {status.body}
            </div>
          ) : null}

          <form action="/auth/request-link" method="post" className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm">
              <span className="metric-label">Email Address</span>
              <input
                name="email"
                type="email"
                placeholder="manager@example.com"
                defaultValue={searchParams.email ?? ""}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-[color:var(--accent)]"
              />
            </label>

            <input type="hidden" name="redirectPath" value={requestedRedirect} />

            <Button size="lg" type="submit">
              Send Magic Link
            </Button>
          </form>
        </Surface>
      </div>
    </main>
  );
}
