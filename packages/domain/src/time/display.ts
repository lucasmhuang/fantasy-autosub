// Times for people to read, in the reader's zone and labelled with it ("Wed 6:41 PM PT",
// "Thu 1:12 AM ET"). Pure: Intl only. ESPN's note keeps its own Pacific formatter
// (adjustment/reason-entry.ts), since the worker matches that note's exact text.
export const PACIFIC = "America/Los_Angeles";

// time: a tracker step ("6:41 PM PT"). weekday: the usual form ("Wed 6:41 PM PT"). date: an
// older moment ("Wed Nov 4, 8:12 PM PT"). numericDate: the emails' form ("Sun, 11/15, 1:00 PM PT").
export type MomentStyle = "time" | "weekday" | "date" | "numericDate";

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${zone}|${JSON.stringify(options)}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
  formatters.set(key, created);
  return created;
}

// A zone this runtime knows, or Pacific: a device whose zone isn't known reads Pacific, labelled.
function knownZone(zone: string): string {
  if (!zone) return PACIFIC;
  try {
    formatter(zone, {});
    return zone;
  } catch (error) {
    if (error instanceof RangeError) return PACIFIC;
    throw error;
  }
}

// The zone a device reports, under the name this runtime knows it by ("america/new_york" is
// "America/New_York"), or null when it isn't a zone the runtime knows.
export function canonicalZone(zone: string): string | null {
  if (zone === "" || zone.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(instant: Date, zone: string, options: Intl.DateTimeFormatOptions): Parts {
  const parts: Parts = {};
  for (const { type, value } of formatter(zone, options).formatToParts(instant))
    parts[type] = value;
  return parts;
}

// "PT", "ET", "CT": the zone's generic short name. Outside the US that name is long ("United
// Kingdom Time"), so those zones take their short one ("GMT", "GMT+9").
export function zoneLabel(instant: Date, zone: string): string {
  const generic = partsOf(instant, zone, { timeZoneName: "shortGeneric" }).timeZoneName ?? "";
  if (generic && !generic.includes(" ")) return generic;
  return partsOf(instant, zone, { timeZoneName: "short" }).timeZoneName ?? generic;
}

export function formatMoment(instant: Date, zone: string, style: MomentStyle): string {
  const at = knownZone(zone);
  const p = partsOf(instant, at, {
    weekday: "short",
    month: style === "numericDate" ? "numeric" : "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const time = `${p.hour}:${p.minute} ${p.dayPeriod} ${zoneLabel(instant, at)}`;
  if (style === "time") return time;
  if (style === "weekday") return `${p.weekday} ${time}`;
  if (style === "date") return `${p.weekday} ${p.month} ${p.day}, ${time}`;
  return `${p.weekday}, ${p.month}/${p.day}, ${time}`;
}

// The instant's calendar date in the zone, as "2026-11-11".
function dateIn(instant: Date, zone: string): string {
  const p = partsOf(instant, zone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

function dayNumber(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

// The reader's today needs only the time (FS-TIME-7, amended by Revision 8); a weekday is enough
// within six days either side of now, in the reader's calendar; further off, the time carries its
// date.
export function formatRecentMoment(instant: Date, zone: string, now: Date): string {
  const at = knownZone(zone);
  const daysApart = Math.abs(dayNumber(dateIn(now, at)) - dayNumber(dateIn(instant, at)));
  if (daysApart === 0) return formatMoment(instant, at, "time");
  return formatMoment(instant, at, daysApart <= 6 ? "weekday" : "date");
}

// ESPN's day by its own date ("2026-11-11" → "Wed Nov 11"), the same in every zone.
export function espnDayLabel(espnDate: string): string {
  const noon = new Date(dayNumber(espnDate) * DAY_MS + DAY_MS / 2);
  const p = partsOf(noon, "UTC", { weekday: "short", month: "short", day: "numeric" });
  return `${p.weekday} ${p.month} ${p.day}`;
}

// ESPN's day, named only where the device's date isn't it (from outside Pacific, between
// midnight and ESPN's day change). A device in Pacific never sees it.
export function countsForEspnDay(instant: Date, zone: string, espnDate: string): string | null {
  return dateIn(instant, knownZone(zone)) === espnDate ? null : espnDayLabel(espnDate);
}

// The instant a Pacific wall-clock time names, across daylight saving's changes.
function pacificInstant(isoDate: string, hour: number): Date {
  const asUtc = dayNumber(isoDate) * DAY_MS + hour * 3_600_000;
  const firstGuess = asUtc - (wallAsUtc(asUtc, PACIFIC) - asUtc);
  return new Date(asUtc - (wallAsUtc(firstGuess, PACIFIC) - firstGuess));
}

// The instant's wall-clock time in the zone, written as if it were UTC (milliseconds).
function wallAsUtc(instant: number, zone: string): number {
  const p = partsOf(new Date(instant), zone, {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  return (
    dayNumber(dateIn(new Date(instant), zone)) * DAY_MS +
    (Number(p.hour) * 60 + Number(p.minute)) * 60_000
  );
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// "2026-10-27T19:10", as a datetime-local field sends it, read in the zone the form named. Null
// when it isn't a date and a time, the zone isn't one, or the clocks skip or repeat that time
// there (a daylight-saving change), since then it names no one moment.
export function parseMomentInZone(value: unknown, zone: string): Date | null {
  const match = typeof value === "string" ? WALL_CLOCK.exec(value) : null;
  const at = canonicalZone(zone);
  if (match === null || at === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const read = new Date(wall);
  const rolledOver =
    read.getUTCMonth() !== month - 1 ||
    read.getUTCDate() !== day ||
    read.getUTCHours() !== hour ||
    read.getUTCMinutes() !== minute;
  if (rolledOver) return null;
  // The zone's offset a day either side; each one that reads back as the typed time is a moment
  // it could mean.
  const offsets = new Set([wall - DAY_MS, wall + DAY_MS].map((t) => wallAsUtc(t, at) - t));
  const moments = [...offsets]
    .map((offset) => wall - offset)
    .filter((t) => wallAsUtc(t, at) === wall);
  const [only, ...others] = moments;
  return only !== undefined && others.length === 0 ? new Date(only) : null;
}

// When ESPN's day changes (midnight Pacific) after the instant, in the device's zone ("3:00 AM ET").
export function espnDayChangeTime(instant: Date, zone: string): string {
  const tomorrow = new Date((dayNumber(dateIn(instant, PACIFIC)) + 1) * DAY_MS);
  return formatMoment(pacificInstant(dateIn(tomorrow, "UTC"), 0), zone, "time");
}

// The instant's calendar date where the reader is, as "2026-11-11" (an unknown zone reads as
// Pacific).
export function calendarDateIn(instant: Date, zone: string): string {
  return dateIn(instant, knownZone(zone));
}

// How old a reading is (FS-TIME-8): "just now" under a minute (a clock slightly ahead included),
// then minutes, then hours; null from 12 hours on, where the time itself says it better.
export function formatAge(instant: Date, now: Date): string | null {
  const minutes = Math.floor((now.getTime() - instant.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 12 ? `${hours} h ago` : null;
}
