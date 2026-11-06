import { describe, expect, it } from "vitest";
import { pacificDaysBetween, parsePacificMoment } from "./pacific-time";

describe("parsePacificMoment", () => {
  it("reads a Pacific wall-clock time in daylight time", () => {
    expect(parsePacificMoment("2026-10-27T19:10")?.toISOString()).toBe("2026-10-28T02:10:00.000Z");
  });

  it("reads a Pacific wall-clock time in standard time", () => {
    expect(parsePacificMoment("2026-11-05T19:10")?.toISOString()).toBe("2026-11-06T03:10:00.000Z");
  });

  it("refuses anything that isn't a date and a time", () => {
    for (const value of ["", "yesterday", "2026-13-01T10:00", "2026-10-27", null]) {
      expect(parsePacificMoment(value)).toBeNull();
    }
  });
});

describe("pacificDaysBetween", () => {
  it("counts Pacific calendar days, so one minute across Pacific midnight is a day", () => {
    const lateEvening = new Date("2026-10-28T06:59:00Z"); // Oct 27, 23:59 PDT
    const justAfter = new Date("2026-10-28T07:00:00Z"); // Oct 28, 00:00 PDT
    expect(pacificDaysBetween(lateEvening, justAfter)).toBe(1);
    expect(pacificDaysBetween(justAfter, new Date("2026-10-29T06:00:00Z"))).toBe(0);
  });
});
