import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// A fact on a card that changes the outcome: points or games that won't count (warn), another
// starter moving (move), why the commissioner handles it (review), why it isn't valid (stop),
// or points taken off (taken).
const GLYPHS = {
  warn: "warn",
  move: "move",
  review: "clock",
  stop: "cross",
  taken: "info",
} satisfies Record<string, IconName>;

export type NoteKind = keyof typeof GLYPHS;

export function Note({ kind, children }: { kind: NoteKind; children: ReactNode }) {
  return (
    <div className={`note note-${kind}`}>
      <Icon name={GLYPHS[kind]} size={13} className="ico" />
      <span>{children}</span>
    </div>
  );
}
