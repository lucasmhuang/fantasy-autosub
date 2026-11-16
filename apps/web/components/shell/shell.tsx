import { AccountPanel, type NavItem, RehearsalBar, TabBar, TopBar } from "@injurysub/ui";
import type { ReactNode } from "react";
import type { ShellData } from "../../lib/server/shell";
import { ZoneReporter } from "./zone-reporter";

export type ShellDestination = "team" | "requests" | "queue" | "file" | "settings";

const MANAGER_NAV: NavItem[] = [
  { key: "team", label: "Team", href: "/app", icon: "tab-team" },
  { key: "requests", label: "Requests", href: "/app/requests", icon: "tab-requests" },
];

// The commissioner's destinations, in order; the Queue carries the count waiting on them.
function commissionerNav(waiting: number | null): NavItem[] {
  return [
    ...MANAGER_NAV,
    {
      key: "queue",
      label: "Queue",
      href: "/commish/requests",
      icon: "tab-queue",
      count: waiting ?? 0,
    },
    { key: "file", label: "File", href: "/commish/requests/new", icon: "tab-file" },
    { key: "settings", label: "Settings", href: "/commish/settings", icon: "tab-settings" },
  ];
}

// Every signed-in page's frame: the environment's bar, the top bar from 1024 px with the account
// control, the account control above the page below it, the page, the footer line, and the tab bar
// below 1024 px. A sync view each page composes from loadShell, so `current` is the page's own.
export function Shell({
  shell,
  current,
  children,
}: {
  shell: ShellData;
  current: ShellDestination;
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
    <div className="app">
      {shell.bar === null ? null : <RehearsalBar mode={shell.bar} />}
      <TopBar items={items} current={current} account={account} />
      <div className="shell-account phone-only">{account}</div>
      <main className="shell-main">
        {children}
        <p className="foot-note">Not affiliated with ESPN or the NBA</p>
      </main>
      <TabBar items={items} current={current} />
      <ZoneReporter stored={shell.zone} />
    </div>
  );
}
