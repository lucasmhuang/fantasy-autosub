// ESPN's day changes at midnight Pacific (CLAUDE.local.md, "From the owner's first manual LM
// substitution"), so the days between a stated moment and now are counted in Pacific.
const ZONE = "America/Los_Angeles";
const DAY_MS = 86_400_000;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// The Pacific wall-clock time of an instant, written as if it were UTC.
function pacificAsUtc(instant: number): number {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(wallClock.formatToParts(new Date(instant)).find((each) => each.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
}

const calendarDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The Pacific calendar date of an instant (YYYY-MM-DD): ESPN's day it falls on, as a date.
export function pacificCalendarDate(instant: Date): string {
  return calendarDate.format(instant);
}

// How many Pacific calendar days lie between two instants: ESPN's days between them.
export function pacificDaysBetween(earlier: Date, later: Date): number {
  const dayOf = (instant: Date) => Math.floor(pacificAsUtc(instant.getTime()) / DAY_MS);
  return dayOf(later) - dayOf(earlier);
}
