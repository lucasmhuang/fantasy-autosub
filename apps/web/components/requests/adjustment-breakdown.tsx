import { formatTenths } from "@injurysub/domain";
import { ADJUSTMENT_LINE_TEXT } from "./labels";

type Line = { day: number; name: string; tenths: number; why: keyof typeof ADJUSTMENT_LINE_TEXT };

// An adjustment's lines, one per player and ESPN day.
export function AdjustmentBreakdown({ lines }: { lines: Line[] }) {
  return (
    <ul className="mt-3 grid gap-1">
      {lines.map((line) => (
        <li key={`${line.day}-${line.name}-${line.why}`} className="flex gap-3">
          <span className="w-14 shrink-0 text-[color:var(--muted)]">Day {line.day}</span>
          <span className="flex-1">
            {line.name}: {ADJUSTMENT_LINE_TEXT[line.why]}
          </span>
          <span>{formatTenths(line.tenths, { signed: true })}</span>
        </li>
      ))}
    </ul>
  );
}
