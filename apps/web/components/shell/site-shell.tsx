import Link from "next/link";
import type { ReactNode } from "react";
import { Button, cn } from "@injurysub/ui";

export function SiteHeader() {
  return (
    <header className="flex flex-col gap-4 rounded-[1.75rem] border border-white/8 bg-black/10 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Link href="/" className="text-xl font-medium tracking-[-0.04em]">
          InjurySub
        </Link>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Cinematic shell, operational core.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        <Button asChild intent="ghost" size="sm">
          <Link href="/app">Manager</Link>
        </Button>
        <Button asChild intent="ghost" size="sm">
          <Link href="/commish/requests">Commissioner</Link>
        </Button>
      </nav>
    </header>
  );
}

export function Surface({
  className,
  children
}: Readonly<{
  className?: string;
  children: ReactNode;
}>) {
  return <section className={cn("glass-panel", className)}>{children}</section>;
}
