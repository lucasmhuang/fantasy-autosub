// ESPN's day changes at midnight Pacific (CLAUDE.local.md, "From the owner's first manual LM
// substitution"), so a moment the commissioner states is read, and its day counted, in Pacific.
const ZONE = "America/Los_Angeles";
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
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

// "2026-10-27T19:10", as a datetime-local field sends it, read as Pacific time.
export function parsePacificMoment(value: unknown): Date | null {
  const match = typeof value === "string" ? MOMENT.exec(value) : null;
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const read = new Date(asUtc);
  const rolledOver =
    read.getUTCMonth() !== month - 1 ||
    read.getUTCDate() !== day ||
    read.getUTCHours() !== hour ||
    read.getUTCMinutes() !== minute;
  if (rolledOver) return null;
  // The zone's offset at the guess, then again at the result, in case the guess crossed a change.
  const firstGuess = asUtc - (pacificAsUtc(asUtc) - asUtc);
  return new Date(asUtc - (pacificAsUtc(firstGuess) - firstGuess));
}

// How many Pacific calendar days lie between two instants: ESPN's days between them.
export function pacificDaysBetween(earlier: Date, later: Date): number {
  const dayOf = (instant: Date) => Math.floor(pacificAsUtc(instant.getTime()) / DAY_MS);
  return dayOf(later) - dayOf(earlier);
}
