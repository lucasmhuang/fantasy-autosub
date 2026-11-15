import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// One destination. `count` is the number waiting on the reader, shown as the app's one badge.
export type NavItem = { key: string; label: string; href: string; icon: IconName; count?: number };

type NavProps = { items: NavItem[]; current: string };

function linkState(item: NavItem, current: string): AnchorHTMLAttributes<HTMLAnchorElement> {
  const waiting = item.count ?? 0;
  return {
    href: item.href,
    "aria-current": item.key === current ? "page" : undefined,
    "aria-label": waiting > 0 ? `${item.label}, ${waiting} need you` : undefined,
  };
}

function Badge({ count = 0 }: { count?: number }) {
  return count > 0 ? <span className="badge">{count}</span> : null;
}

// The phone's bottom bar. Labels always show.
export function TabBar({ items, current }: NavProps) {
  const style: CSSProperties & Record<"--tabs", number> = { "--tabs": items.length };
  return (
    <nav className="tabbar" style={style} aria-label="Main">
      {items.map((item) => (
        <a key={item.key} className="tab" {...linkState(item, current)}>
          <Icon name={item.icon} size={22} strokeWidth={1.8} />
          <Badge count={item.count} />
          {item.label}
        </a>
      ))}
    </nav>
  );
}

// The same destinations, in the same order, in the page header at desktop widths.
export function TopBar({ items, current, account }: NavProps & { account: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <span className="wordmark">InjurySub</span>
        <nav className="topnav" aria-label="Main">
          {items.map((item) => (
            <a key={item.key} {...linkState(item, current)}>
              <Icon name={item.icon} size={20} strokeWidth={1.8} />
              {item.label}
              <Badge count={item.count} />
            </a>
          ))}
        </nav>
        {account}
      </div>
    </header>
  );
}
