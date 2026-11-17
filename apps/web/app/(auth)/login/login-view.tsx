import { BrandMark, Button, Notice, TextField } from "@injurysub/ui";
import type { ReactNode } from "react";
import type { SignInMessage } from "./status-messages";

export type LoginStep = { kind: "email"; email: string | null } | { kind: "code"; email: string };

export type LoginViewProps = {
  step: LoginStep;
  sender: string;
  // How long a code works (SIGN_IN_CODE_TTL_MINUTES), said on the code step.
  ttlMinutes: number;
  redirectPath: string;
  message: SignInMessage | null;
};

// The sign-in page, both steps, as plain forms: no script, so it works the moment it loads.
export function LoginView({ step, sender, ttlMinutes, redirectPath, message }: LoginViewProps) {
  const fieldError = message?.place === "field" ? message.text : undefined;
  const notice =
    message?.place === "notice" ? <Notice tone={message.tone}>{message.text}</Notice> : null;
  return (
    <main className="signin">
      {step.kind === "email" ? (
        <EmailStep
          email={step.email}
          redirectPath={redirectPath}
          notice={notice}
          error={fieldError}
        />
      ) : (
        <CodeStep
          email={step.email}
          sender={sender}
          ttlMinutes={ttlMinutes}
          redirectPath={redirectPath}
          notice={notice}
          error={fieldError}
        />
      )}
    </main>
  );
}

type StepProps = { redirectPath: string; notice: ReactNode; error: string | undefined };

function Header({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header>
      <div className="brand">
        <BrandMark />
        InjurySub
      </div>
      <h1 className="t-title signin-title">{title}</h1>
      <p className="lede">{children}</p>
    </header>
  );
}

function EmailStep({ email, redirectPath, notice, error }: StepProps & { email: string | null }) {
  return (
    <>
      <Header title="Sign in">{"Enter your email and we'll send you a 6-digit code."}</Header>
      {notice}
      <form action="/auth/request-code" method="post">
        <TextField
          id="email"
          label="Email"
          hint="The address your commissioner registered for you."
          error={error}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
          defaultValue={email ?? ""}
        />
        <input type="hidden" name="redirectPath" value={redirectPath} />
        <Button variant="primary" type="submit" className="w-full">
          Email me a code
        </Button>
      </form>
    </>
  );
}

function CodeStep({
  email,
  sender,
  ttlMinutes,
  redirectPath,
  notice,
  error,
}: StepProps & { email: string; sender: string; ttlMinutes: number }) {
  return (
    <>
      <Header title="Check your email">
        We sent a code to <span className="addr">{email}</span>. It works for {ttlMinutes} minutes.
      </Header>
      {notice}
      <form action="/auth/verify-code" method="post">
        <TextField
          id="code"
          label="6-digit code"
          hint={`From ${sender}. Not there? Check Junk, and mark it Not junk.`}
          error={error}
          code
          name="code"
          type="text"
          placeholder="······"
          required
        />
        <KeptFields email={email} redirectPath={redirectPath} />
        <Button variant="primary" type="submit" className="w-full">
          Sign in
        </Button>
      </form>
      <OtherWays email={email} redirectPath={redirectPath} />
    </>
  );
}

// What the code step's forms carry back: the address and where to go after.
function KeptFields({ email, redirectPath }: { email: string; redirectPath: string }) {
  return (
    <>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="redirectPath" value={redirectPath} />
    </>
  );
}

// A new code (marked as from the code step, so a failure comes back here), a different email.
function OtherWays({ email, redirectPath }: { email: string; redirectPath: string }) {
  return (
    <div className="secondary">
      <form action="/auth/request-code" method="post">
        <KeptFields email={email} redirectPath={redirectPath} />
        <input type="hidden" name="step" value="code" />
        <Button variant="ghost" icon="refresh" type="submit" className="is-back">
          Send a new code
        </Button>
      </form>
      <Button variant="ghost" back asChild>
        <a href={`/login?redirect=${encodeURIComponent(redirectPath)}`}>Use a different email</a>
      </Button>
      <p className="signin-help">Still nothing? Ask your commissioner.</p>
    </div>
  );
}
