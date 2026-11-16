import { Button } from "@injurysub/ui";
import Link from "next/link";
import { AutomationSwitch } from "./automation-switch";

// The commissioner pages' header: the pages the shell's destinations don't name (proving, the
// misuse alerts), and the off switch (O11). The shell carries the rest and sign-out.
export function CommishHeader({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <CommishNav title={title} />
      <AutomationSwitch />
    </div>
  );
}

function CommishNav({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="display-kicker">Commissioner</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">{title}</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild intent="ghost" size="sm">
          <Link href="/commish/proving">Proving</Link>
        </Button>
        <Button asChild intent="ghost" size="sm">
          <Link href="/commish/alerts">Alerts</Link>
        </Button>
      </div>
    </div>
  );
}
