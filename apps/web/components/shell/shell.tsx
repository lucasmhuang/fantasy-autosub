import { AccountPanel, RehearsalBar } from "@injurysub/ui";
import type { ReactNode } from "react";
import type { ShellData } from "../../lib/server/shell";
import { commissionerNav, MANAGER_NAV, type ShellDestination, ShellFrame } from "./shell-frame";
import { ZoneReporter } from "./zone-reporter";

// A signed-in page's frame (`ShellFrame`) filled from loadShell: the person's account, the
// commissioner's destinations and Queue count, the environment's bar. A sync view each page
// composes, so `current` is the page's own.
export function Shell({
  shell,
  current,
  tabs = true,
  children,
}: {
  shell: ShellData;
  current: ShellDestination;
  // A step page (Choose, Confirm) has no tab bar: its own actions sit at the bottom.
  tabs?: boolean;
  children: ReactNode;
}) {
  const items = shell.commissioner ? commissionerNav(shell.waiting) : MANAGER_NAV;
  const account = (
    <AccountPanel
      initial={shell.account.initial}
      email={shell.account.email}
      team={shell.account.team ?? undefined}
    />
  );
  return (
    <ShellFrame
      items={items}
      current={current}
      account={account}
      bar={shell.bar === null ? null : <RehearsalBar mode={shell.bar} />}
      tabs={tabs}
      after={<ZoneReporter stored={shell.zone} />}
    >
      {children}
    </ShellFrame>
  );
}
