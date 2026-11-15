import { cn } from "../lib/cn";
import { Button } from "./button";

function AccountRow({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="t-body grid grid-cols-[auto_minmax(0,1fr)] gap-x-(--space-12) gap-y-(--space-4) border-line border-t py-(--space-10) first:border-t-0">
      <span className="text-text-meta">{label}</span>
      <span className={cn("text-right font-semibold tabular-nums", truncate && "ellipsis")}>
        {value}
      </span>
    </div>
  );
}

export type AccountPanelProps = {
  // The account control's face: the person's initial.
  initial: string;
  email: string;
  team?: string;
  className?: string;
};

// The account control and the panel it opens: who is signed in, and signing out of this
// device only. A disclosure, so it works with no script.
export function AccountPanel({ initial, email, team, className }: AccountPanelProps) {
  return (
    <details className={cn("relative", className)}>
      <summary
        className="acct grid list-none place-items-center [&::-webkit-details-marker]:hidden"
        aria-label="Account and sign out"
      >
        {initial}
      </summary>
      <section
        className="panel absolute top-full right-0 z-10 mt-(--space-8) w-[min(320px,calc(100vw-32px))] px-(--space-16) py-(--space-6)"
        aria-label="Account"
      >
        <AccountRow label="Signed in as" value={email} truncate />
        {team && <AccountRow label="Team" value={team} />}
        <div className="py-(--space-10)">
          <form method="post" action="/logout">
            <Button variant="secondary" type="submit" className="w-full">
              Sign out on this device
            </Button>
          </form>
        </div>
      </section>
    </details>
  );
}
