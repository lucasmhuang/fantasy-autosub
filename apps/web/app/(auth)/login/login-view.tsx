import { Button, Notice, TextField } from "@injurysub/ui";
import type { ReactNode } from "react";
import type { SignInMessage } from "./status-messages";

export type LoginStep = { kind: "email"; email: string | null } | { kind: "code"; email: string };

export type LoginViewProps = {
  step: LoginStep;
  sender: string;
  redirectPath: string;
  message: SignInMessage | null;
};

// The sign-in page, both steps, as plain forms: no script, so it works the moment it loads.
export function LoginView({ step, sender, redirectPath, message }: LoginViewProps) {
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
      <div className="brand">InjurySub</div>
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
  redirectPath,
  notice,
  error,
}: StepProps & { email: string; sender: string }) {
  const kept = (
    <>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="redirectPath" value={redirectPath} />
    </>
  );
  return (
    <>
      <Header title="Check your email">
        We sent a code to <span className="addr">{email}</span>. It works for 10 minutes.
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
        {kept}
        <Button variant="primary" type="submit" className="w-full">
          Sign in
        </Button>
      </form>
      <div className="secondary">
        <form action="/auth/request-code" method="post">
          {kept}
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
    </>
  );
}
