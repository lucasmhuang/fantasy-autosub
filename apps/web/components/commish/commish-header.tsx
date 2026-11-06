import { Button } from "@injurysub/ui";
import Link from "next/link";
import { SignOutForm } from "../shell/site-shell";

// The commissioner pages' header: the way back to their team (D17), and sign-out.
export function CommishHeader({ title, hasTeam }: { title: string; hasTeam: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="display-kicker">Commissioner</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">{title}</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild intent="ghost" size="sm">
          <Link href="/commish/requests">Requests</Link>
        </Button>
        <Button asChild intent="ghost" size="sm">
          <Link href="/commish/settings">Settings</Link>
        </Button>
        <Button asChild intent="ghost" size="sm">
          <Link href="/commish/requests/new">File a request</Link>
        </Button>
        {hasTeam ? (
          <Button asChild intent="ghost" size="sm">
            <Link href="/app">Your team</Link>
          </Button>
        ) : null}
        <SignOutForm />
      </div>
    </div>
  );
}
