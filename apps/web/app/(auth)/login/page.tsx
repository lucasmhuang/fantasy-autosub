import { loadServerEnv } from "@injurysub/config";
import { resolveSafeRedirectPath } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Surface } from "../../../components/shell/site-shell";
import { getCurrentAuthenticatedSession, getSafePostLoginPath } from "../../../lib/server/auth";
import { renderStatusMessage, type StatusMessage } from "./status-messages";

// What the sign-in routes write into /login.
type LoginSearchParams = {
  step?: string;
  status?: string;
  email?: string;
  redirect?: string;
  retry?: string;
  tries?: string;
};

const inputClassName =
  "rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-[color:var(--accent)]";

function wholeNumber(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

export default async function LoginPage(props: { searchParams: Promise<LoginSearchParams> }) {
  const session = await getCurrentAuthenticatedSession();
  const searchParams = await props.searchParams;
  const redirectPath = resolveSafeRedirectPath(searchParams.redirect);

  if (session) {
    redirect(getSafePostLoginPath({ redirectPath, role: session.user.role }));
  }

  const sender = loadServerEnv().EMAIL_FROM_ADDRESS;
  const email = searchParams.email ?? null;
  const status = renderStatusMessage(searchParams.status ?? null, {
    email,
    sender,
    retryAfterMinutes: wholeNumber(searchParams.retry),
    triesLeft: wholeNumber(searchParams.tries),
  });
  // The step lives in the address, so a reload, or iOS reopening the home-screen app, keeps it.
  const codeStepEmail = searchParams.step === "code" && email ? email : null;

  return (
    <main className="page-shell">
      <div className="page-inner flex min-h-[calc(100vh-3rem)] items-center justify-center">
        <Surface className="w-full max-w-xl rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Sign In</p>
          {codeStepEmail === null ? (
            <EmailStep email={email} redirectPath={redirectPath} status={status} />
          ) : (
            <CodeStep
              email={codeStepEmail}
              sender={sender}
              redirectPath={redirectPath}
              status={status}
            />
          )}
        </Surface>
      </div>
    </main>
  );
}

function EmailStep(props: {
  email: string | null;
  redirectPath: string;
  status: StatusMessage | null;
}) {
  return (
    <>
      <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">
        Sign in with your league email.
      </h1>
      <p className="mt-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
        Enter the email your commissioner added. InjurySub will email you a 6-digit code to type on
        this page.
      </p>
      <StatusNotice status={props.status} />
      <form action="/auth/request-code" method="post" className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm">
          <span className="metric-label">Email Address</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="manager@example.com"
            defaultValue={props.email ?? ""}
            className={inputClassName}
          />
        </label>
        <input type="hidden" name="redirectPath" value={props.redirectPath} />
        <Button size="lg" type="submit">
          Send Code
        </Button>
      </form>
    </>
  );
}

function CodeStep(props: {
  email: string;
  sender: string;
  redirectPath: string;
  status: StatusMessage | null;
}) {
  return (
    <>
      <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">Enter your sign-in code.</h1>
      <p className="mt-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
        The code comes from {props.sender}. If it isn&apos;t in your inbox, check your junk folder.
      </p>
      <StatusNotice status={props.status} />
      <form action="/auth/verify-code" method="post" className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm">
          <span className="metric-label">Sign-In Code</span>
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className={inputClassName}
          />
        </label>
        <input type="hidden" name="email" value={props.email} />
        <input type="hidden" name="redirectPath" value={props.redirectPath} />
        <Button size="lg" type="submit">
          Sign In
        </Button>
      </form>
      <NewCodeControls email={props.email} redirectPath={props.redirectPath} />
    </>
  );
}

// "Send a new code" keeps the destination; the link goes back to the first step.
function NewCodeControls(props: { email: string; redirectPath: string }) {
  return (
    <>
      <form
        action="/auth/request-code"
        method="post"
        className="mt-6 flex flex-wrap items-center gap-4"
      >
        <input type="hidden" name="email" value={props.email} />
        <input type="hidden" name="redirectPath" value={props.redirectPath} />
        <Button intent="ghost" size="sm" type="submit">
          Send a new code
        </Button>
        <Link
          href={`/login?redirect=${encodeURIComponent(props.redirectPath)}`}
          className="text-sm text-[color:var(--muted)] underline"
        >
          Use a different email
        </Link>
      </form>
      <p className="mt-6 text-sm text-[color:var(--muted)]">
        Still nothing? Ask your commissioner.
      </p>
    </>
  );
}

function StatusNotice({ status }: { status: StatusMessage | null }) {
  if (!status) {
    return null;
  }

  return (
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
  );
}
