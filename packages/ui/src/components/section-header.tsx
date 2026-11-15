import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type SectionHeaderProps = {
  children: ReactNode;
  // How to read the list's numbers ("Week · avg"), only where they need it.
  aside?: string;
  // A list that is a route or a status takes its colour.
  tone?: "ok" | "wait";
  // Uppercase, kept for the board's Starters and Bench.
  caps?: boolean;
  id?: string;
};

export function SectionHeader({ children, aside, tone, caps = false, id }: SectionHeaderProps) {
  return (
    <div className="section-head">
      <h2
        id={id}
        className={cn(
          caps ? "t-eyebrow" : "t-label",
          tone === "ok" && "text-ok",
          tone === "wait" && "text-wait"
        )}
      >
        {children}
      </h2>
      {aside && <span className="aside">{aside}</span>}
    </div>
  );
}
