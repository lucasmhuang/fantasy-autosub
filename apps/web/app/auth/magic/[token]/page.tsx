import { findLoginLinkByToken } from "@injurysub/db";
import { isMagicLinkActive } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import Link from "next/link";
import { Surface } from "../../../../components/shell/site-shell";
import { getWebDatabaseConnection } from "../../../../lib/server/db";

function InvalidMagicLinkState(props: { description: string; title: string }) {
  return (
    <main className="page-shell">
      <div className="page-inner flex min-h-[calc(100vh-3rem)] items-center justify-center">
        <Surface className="w-full max-w-xl rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Magic Link</p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">{props.title}</h1>
          <p className="mt-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            {props.description}
          </p>
          <div className="mt-8">
            <Button asChild size="lg">
              <Link href="/login">Request a New Link</Link>
            </Button>
          </div>
        </Surface>
      </div>
    </main>
  );
}

export default async function MagicLinkPage(props: {
  params: Promise<{
    token: string;
  }>;
}) {
  const { token } = await props.params;
  const { db } = getWebDatabaseConnection();
  const link = await findLoginLinkByToken(db, token);

  if (!link) {
    return (
      <InvalidMagicLinkState
        title="This sign-in link is invalid."
        description="Request a new sign-in link from the login page."
      />
    );
  }

  const now = new Date();

  if (!link.user.isActive) {
    return (
      <InvalidMagicLinkState
        title="This account can’t sign in."
        description="Your commissioner may need to reactivate your account."
      />
    );
  }

  if (!isMagicLinkActive(link.token.status, link.token.expiresAt, link.token.usedAt, now)) {
    const title =
      link.token.status === "used"
        ? "This sign-in link was already used."
        : "This sign-in link has expired.";

    return (
      <InvalidMagicLinkState
        title={title}
        description="Request a new sign-in link from the login page to continue."
      />
    );
  }

  return (
    <main className="page-shell">
      <div className="page-inner flex min-h-[calc(100vh-3rem)] items-center justify-center">
        <Surface className="w-full max-w-xl rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Magic Link Sign-In</p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">
            Continue as {link.user.displayName}.
          </h1>
          <p className="mt-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            You are about to sign in as{" "}
            <span className="text-[color:var(--foreground)]">{link.user.email}</span>. Tap continue
            to consume this one-time link and create a session on this device.
          </p>

          <form
            action={`/auth/magic/${token}/consume`}
            method="post"
            className="mt-8 flex flex-col gap-4"
          >
            <Button size="lg" type="submit">
              Continue to InjurySub
            </Button>
            <Button asChild intent="ghost" size="lg">
              <Link href="/login">Back to Login</Link>
            </Button>
          </form>
        </Surface>
      </div>
    </main>
  );
}
