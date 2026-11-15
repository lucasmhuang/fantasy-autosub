import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

// A day of the matchup and its net change to the adjustment, signed ("−52.8", "+26.7"), or
// none.
export type StripDay = { day: string; date: string; net?: string };
// No-game days folded into one cell ("All-Star break", "Fri 19 – Sun 21"), spanning `span` days.
export type StripBreak = { title: string; dates: string; span: number };

export type WeekStripProps = {
  cells: (StripDay | StripBreak)[];
  // Days in a row: the cell count, or 7 for the two-row All-Star matchup.
  columns?: number;
  label?: string;
};

function DayCell({ day, date, net }: StripDay) {
  // Either minus counts: the typographic one, or the hyphen domain's formatTenths writes.
  const tone = net && /^[-−]/.test(net) ? "neg" : net?.startsWith("+") ? "pos" : null;
  return (
    <div className={cn("day", tone)}>
      <div className="n">{day}</div>
      <div className="t">{date}</div>
      <div className="a">{net ?? "·"}</div>
    </div>
  );
}

// The week as a row of days, each with its net, so the manager sees when points come off and
// when they come back. The lines under it list every credit and deduction.
export function WeekStrip({ cells, columns, label = "Adjustment by day, net" }: WeekStripProps) {
  const style: CSSProperties & Record<"--days", number> = { "--days": columns ?? cells.length };
  return (
    <div className="strip" style={style} aria-label={label}>
      {cells.map((cell) =>
        "title" in cell ? (
          <div key={cell.dates} className="day-break" style={{ gridColumn: `span ${cell.span}` }}>
            <b>{cell.title}</b>
            <span>{cell.dates}</span>
          </div>
        ) : (
          <DayCell key={`${cell.day} ${cell.date}`} {...cell} />
        )
      )}
    </div>
  );
}
