import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// A full-width sentence that changes what the reader expects: a warning before they act
// (wait), what happens next (info), a failure with its way out (fail), or points that won't
// count (taken).
const GLYPHS = {
  wait: "warn",
  info: "info",
  fail: "warn",
  taken: "info",
} satisfies Record<string, IconName>;

export type NoticeTone = keyof typeof GLYPHS;

export type NoticeProps = {
  tone: NoticeTone;
  children: ReactNode;
  // A failure's own retry.
  action?: { label: string; href: string };
  // For a notice that reports a change while the page is open: read out politely.
  announce?: boolean;
};

export function Notice({ tone, children, action, announce = false }: NoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role={announce ? "status" : undefined}>
      <Icon name={GLYPHS[tone]} className="ico" />
      <div>
        {children}
        {action && (
          <a className="act" href={action.href}>
            {action.label}
          </a>
        )}
      </div>
    </div>
  );
}
