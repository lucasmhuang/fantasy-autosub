import { Button } from "@injurysub/ui";
import { Surface } from "../../../components/shell/site-shell";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <div className="page-inner flex min-h-[calc(100vh-3rem)] items-center justify-center">
        <Surface className="w-full max-w-xl rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Magic Link Sign-In</p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">
            Sign in with your league email.
          </h1>
          <p className="mt-4 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            This is the first auth screen scaffold. The final flow will submit an email, send a
            single-use link, then land on a confirmation screen before consuming the token.
          </p>

          <form className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm">
              <span className="metric-label">Email Address</span>
              <input
                type="email"
                placeholder="manager@example.com"
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-[color:var(--accent)]"
              />
            </label>

            <Button size="lg" type="submit">
              Send Magic Link
            </Button>
          </form>
        </Surface>
      </div>
    </main>
  );
}
