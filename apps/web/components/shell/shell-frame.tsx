import { type NavItem, TabBar, TopBar } from "@injurysub/ui";
import type { ReactNode } from "react";

export type ShellDestination = "team" | "requests" | "queue" | "file" | "settings";

export const MANAGER_NAV: NavItem[] = [
  { key: "team", label: "Team", href: "/app", icon: "tab-team" },
  { key: "requests", label: "Requests", href: "/app/requests", icon: "tab-requests" },
];

// The commissioner's destinations, in order; the Queue carries the count waiting on them.
export function commissionerNav(waiting: number | null): NavItem[] {
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
// control, the account control above the page below it, the page, the footer line, and the tab
// bar below 1024 px. The page (`Shell`) and its loading state both draw it, so it doesn't move
// when the page lands (IF-LOAD-1).
export function ShellFrame({
  items,
  current,
  account,
  bar = null,
  tabs = true,
  after = null,
  motion,
  children,
}: {
  items: NavItem[];
  current: ShellDestination;
  account: ReactNode;
  bar?: ReactNode;
  // A step page (Choose, Confirm) has no tab bar: its own actions sit at the bottom.
  tabs?: boolean;
  // What the page adds after the frame (the zone reporter).
  after?: ReactNode;
  // A loading state's placeholders, or a page that replaces them, each with its fade
  // (IF-MOTION-10).
  motion?: "is-loading" | "arrives";
  children: ReactNode;
}) {
  return (
    <div className="app">
      {bar}
      <TopBar items={items} current={current} account={account} />
      <div className="shell-account phone-only">{account}</div>
      <main className={motion === undefined ? "shell-main" : `shell-main ${motion}`}>
        {children}
        <p className="foot-note">Not affiliated with ESPN or the NBA</p>
      </main>
      {tabs && <TabBar items={items} current={current} />}
      {after}
    </div>
  );
}

// The account control's place while a page loads: the same circle, with no initial and nothing
// to open.
export function AccountPlaceholder() {
  return <span className="acct block" aria-hidden="true" />;
}

// The frame around a manager's page while it loads: the destinations every signed-in person has.
export function ManagerLoadingFrame(props: {
  current: ShellDestination;
  tabs?: boolean;
  children: ReactNode;
}) {
  return (
    <ShellFrame
      items={MANAGER_NAV}
      current={props.current}
      account={<AccountPlaceholder />}
      tabs={props.tabs}
      motion="is-loading"
    >
      {props.children}
    </ShellFrame>
  );
}

// The frame around a commissioner's page while it loads, before the Queue's count is read.
export function CommishLoadingFrame(props: { current: ShellDestination; children: ReactNode }) {
  return (
    <ShellFrame
      items={commissionerNav(null)}
      current={props.current}
      account={<AccountPlaceholder />}
      motion="is-loading"
    >
      {props.children}
    </ShellFrame>
  );
}
