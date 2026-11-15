import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";

// A request's or a player's status as a word in a pill. The consumer gives the word; its kind
// sets the colour and the glyph, so colour never carries the meaning alone.
const PILLS = {
  waiting: { className: "pill-wait", glyph: "clock" },
  "in-line": { className: "pill-queued", glyph: "dots" },
  "in-progress": { className: "pill-busy", glyph: "ring" },
  done: { className: "pill-ok", glyph: "check" },
  stopped: { className: "pill-neutral", glyph: "cross" },
  undone: { className: "pill-neutral", glyph: "back" },
  out: { className: "pill-out", glyph: null },
  suspended: { className: "pill-wait", glyph: null },
  label: { className: "pill-outline", glyph: null },
} satisfies Record<string, { className: string; glyph: IconName | null }>;

export type PillKind = keyof typeof PILLS;

export type StatusPillProps = {
  kind: PillKind;
  // The card size.
  small?: boolean;
  children: ReactNode;
};

export function StatusPill({ kind, small = false, children }: StatusPillProps) {
  const { className, glyph } = PILLS[kind];
  return (
    <span className={cn("pill", className, small && "pill-s")}>
      {glyph && <Icon name={glyph} size={12} strokeWidth={2.4} />}
      {children}
    </span>
  );
}
