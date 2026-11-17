import { calendarDateIn, espnDayLabel } from "@injurysub/domain";
import { pacificCalendarDate } from "./pacific-time";

const DAY_MS = 86_400_000;

export type FilingDays = {
  options: { value: string; label: string }[];
  chosen: string;
  // The week's first and last days as ESPN's dates.
  firstDate: string;
  lastDate: string;
};

function addDays(isoDate: string, days: number): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

// The days the commissioner can say the manager asked on, as dates on the device's calendar (the
// time beside it is read in the device's zone). ESPN's day is a Pacific date counted back from
// today, as the route counts it; from the week's first through the device's today, which east of
// Pacific can be one date past the week's last. Today is chosen.
export function filingDays(
  week: { today: number; days: readonly number[] },
  now: Date,
  zone: string
): FilingDays {
  const pacificToday = pacificCalendarDate(now);
  const firstDate = addDays(pacificToday, Math.min(...week.days) - week.today);
  const lastDate = addDays(pacificToday, Math.max(...week.days) - week.today);
  const deviceToday = calendarDateIn(now, zone);
  const end = [deviceToday, addDays(lastDate, 1)].sort()[0] ?? lastDate;
  const options: FilingDays["options"] = [];
  for (let date = firstDate; date <= end; date = addDays(date, 1)) {
    options.push({ value: date, label: espnDayLabel(date) });
  }
  if (options.length === 0) options.push({ value: firstDate, label: espnDayLabel(firstDate) });
  return { options, chosen: options.at(-1)?.value ?? firstDate, firstDate, lastDate };
}
