import { describe, expect, it } from "vitest";
import { pacificCalendarDate, pacificDaysBetween } from "./pacific-time";

describe("pacificDaysBetween", () => {
  it("counts Pacific calendar days, so one minute across Pacific midnight is a day", () => {
    const lateEvening = new Date("2026-10-28T06:59:00Z"); // Oct 27, 23:59 PDT
    const justAfter = new Date("2026-10-28T07:00:00Z"); // Oct 28, 00:00 PDT
    expect(pacificDaysBetween(lateEvening, justAfter)).toBe(1);
    expect(pacificDaysBetween(justAfter, new Date("2026-10-29T06:00:00Z"))).toBe(0);
  });
});

describe("pacificCalendarDate", () => {
  // ESPN's day runs midnight to midnight Pacific: an evening tip's UTC date is the next day.
  it("gives the Pacific calendar date of an instant, not its UTC date", () => {
    expect(pacificCalendarDate(new Date("2026-10-28T03:00:00Z"))).toBe("2026-10-27");
    expect(pacificCalendarDate(new Date("2026-10-28T07:00:00Z"))).toBe("2026-10-28");
  });

  it("follows the change of offset when daylight time ends", () => {
    expect(pacificCalendarDate(new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01"); // 23:30 PST
    expect(pacificCalendarDate(new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02"); // 00:00 PST
  });
});
