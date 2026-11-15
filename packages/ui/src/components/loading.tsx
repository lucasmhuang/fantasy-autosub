import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Placeholder widths for the name and the meta line, varied so the rows don't read as a grid.
const PLACEHOLDER_WIDTHS = [
  ["w-[62%]", "w-[84%]"],
  ["w-[54%]", "w-[76%]"],
  ["w-[70%]", "w-[80%]"],
] as const;

function PlaceholderRow({ slot, index }: { slot: string; index: number }) {
  const [name, meta] =
    PLACEHOLDER_WIDTHS[index % PLACEHOLDER_WIDTHS.length] ?? PLACEHOLDER_WIDTHS[0];
  return (
    <div className="row is-loading">
      <div className="row-slot text-text-meta">{slot}</div>
      <div className="row-face" />
      <div>
        <div className={cn("sk h-[14px]", name)} />
        <div className={cn("sk mt-(--space-8) h-[10px]", meta)} />
      </div>
      <div>
        <div className="sk ml-auto h-[14px] w-[40px]" />
      </div>
    </div>
  );
}

// Rows the size of real ones, so nothing shifts when the data lands. The slots are already
// known; everything else waits.
export function LoadingRows({ slots }: { slots: string[] }) {
  return (
    <div className="rows" aria-hidden="true">
      {slots.map((slot, index) => (
        <PlaceholderRow key={`${index}-${slot}`} slot={slot} index={index} />
      ))}
    </div>
  );
}

// Once a read is slow: what is slow and how long it can take.
export function SlowNote({ children }: { children: ReactNode }) {
  return (
    <div className="slow" role="status">
      <span className="spin" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
