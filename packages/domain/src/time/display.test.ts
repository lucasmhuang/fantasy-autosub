import { describe, expect, it } from "vitest";
import {
  canonicalZone,
  countsForEspnDay,
  espnDayChangeTime,
  espnDayLabel,
  formatMoment,
  formatRecentMoment,
  PACIFIC,
  parseMomentInZone,
} from "./display";

const EASTERN = "America/New_York";
// Thu Nov 12, 1:12 AM in Eastern time is still Wed Nov 11, 10:12 PM in Pacific: ESPN's Wednesday.
const AFTER_MIDNIGHT_EAST = new Date("2026-11-12T06:12:00.000Z");

describe("formatMoment", () => {
  it("writes the same instant in each device's zone, labelled", () => {
    expect(formatMoment(AFTER_MIDNIGHT_EAST, PACIFIC, "weekday")).toBe("Wed 10:12 PM PT");
    expect(formatMoment(AFTER_MIDNIGHT_EAST, EASTERN, "weekday")).toBe("Thu 1:12 AM ET");
    expect(formatMoment(AFTER_MIDNIGHT_EAST, "America/Chicago", "weekday")).toBe("Thu 12:12 AM CT");
  });

  it("drops the weekday for a tracker step, and adds the date for an older moment", () => {
    expect(formatMoment(AFTER_MIDNIGHT_EAST, EASTERN, "time")).toBe("1:12 AM ET");
    expect(formatMoment(new Date("2026-11-05T04:12:00.000Z"), PACIFIC, "date")).toBe(
      "Wed Nov 4, 8:12 PM PT"
    );
  });

  it("keeps the label generic across daylight saving's end and start", () => {
    // 1:30 AM happens twice on Sun Nov 1, 2026: daylight time, then standard time.
    expect(formatMoment(new Date("2026-11-01T08:30:00.000Z"), PACIFIC, "weekday")).toBe(
      "Sun 1:30 AM PT"
    );
    expect(formatMoment(new Date("2026-11-01T09:30:00.000Z"), PACIFIC, "weekday")).toBe(
      "Sun 1:30 AM PT"
    );
    // On Sun Mar 14, 2027, Pacific clocks jump from 1:59 AM to 3:00 AM.
    expect(formatMoment(new Date("2027-03-14T09:59:00.000Z"), PACIFIC, "time")).toBe("1:59 AM PT");
    expect(formatMoment(new Date("2027-03-14T10:00:00.000Z"), PACIFIC, "time")).toBe("3:00 AM PT");
  });

  it("falls back to Pacific, labelled, for a zone it doesn't know", () => {
    expect(formatMoment(AFTER_MIDNIGHT_EAST, "Mars/Olympus", "weekday")).toBe("Wed 10:12 PM PT");
    expect(formatMoment(AFTER_MIDNIGHT_EAST, "", "weekday")).toBe("Wed 10:12 PM PT");
  });

  it("labels a zone outside the US by its short name, not a long one", () => {
    expect(formatMoment(AFTER_MIDNIGHT_EAST, "Europe/London", "time")).toBe("6:12 AM GMT");
  });

  it("writes the emails' Pacific form", () => {
    expect(formatMoment(new Date("2026-11-15T21:00:00.000Z"), PACIFIC, "numericDate")).toBe(
      "Sun, 11/15, 1:00 PM PT"
    );
  });
});

describe("formatRecentMoment", () => {
  const now = new Date("2026-11-15T20:00:00.000Z");

  it("gives a moment from the past six days its weekday, and an older one its date", () => {
    expect(formatRecentMoment(new Date("2026-11-09T20:00:00.000Z"), PACIFIC, now)).toBe(
      "Mon 12:00 PM PT"
    );
    expect(formatRecentMoment(new Date("2026-11-08T20:00:00.000Z"), PACIFIC, now)).toBe(
      "Sun Nov 8, 12:00 PM PT"
    );
  });

  it("counts the days in the reader's zone", () => {
    // Sun Nov 8, 10:30 PM in Pacific is already Mon Nov 9 in Eastern time: six days back there.
    const lateSunday = new Date("2026-11-09T06:30:00.000Z");

    expect(formatRecentMoment(lateSunday, PACIFIC, now)).toBe("Sun Nov 8, 10:30 PM PT");
    expect(formatRecentMoment(lateSunday, EASTERN, now)).toBe("Mon 1:30 AM ET");
  });
});

describe("a time typed in a zone", () => {
  const at = (value: unknown, zone: string) =>
    parseMomentInZone(value, zone)?.toISOString() ?? null;

  it("is read in the zone the form named", () => {
    expect(at("2026-10-27T19:10", PACIFIC)).toBe("2026-10-28T02:10:00.000Z");
    expect(at("2026-11-05T19:10", PACIFIC)).toBe("2026-11-06T03:10:00.000Z");
    // 5:58 PM Eastern is 2:58 PM Pacific.
    expect(at("2026-10-27T17:58", EASTERN)).toBe("2026-10-27T21:58:00.000Z");
    // Thu 1:12 AM Eastern, while ESPN's day is still Wednesday.
    expect(at("2026-11-12T01:12", EASTERN)).toBe(AFTER_MIDNIGHT_EAST.toISOString());
  });

  it.each([
    ["2026-11-01T01:30", EASTERN],
    ["2026-11-01T01:30", PACIFIC],
    ["2027-03-14T02:30", EASTERN],
    ["2027-03-14T02:30", PACIFIC],
  ])("is refused at %s in %s, an hour the clocks repeat or skip there", (value, zone) => {
    expect(at(value, zone)).toBeNull();
  });

  it("is read on either side of a clock change", () => {
    expect(at("2026-11-01T00:59", EASTERN)).toBe("2026-11-01T04:59:00.000Z");
    expect(at("2026-11-01T02:00", EASTERN)).toBe("2026-11-01T07:00:00.000Z");
    expect(at("2027-03-14T01:59", EASTERN)).toBe("2027-03-14T06:59:00.000Z");
    expect(at("2027-03-14T03:00", EASTERN)).toBe("2027-03-14T07:00:00.000Z");
  });

  it("is refused when it isn't a date and a time, or the zone isn't one", () => {
    for (const value of [
      "",
      "yesterday",
      "2026-13-01T10:00",
      "2026-10-27",
      "2026-11-05T10:99",
      "2026-11-05T10:60",
      "2026-11-05T24:00",
      null,
    ]) {
      expect(at(value, PACIFIC)).toBeNull();
    }
    expect(at("2026-10-27T19:10", "Not/A_Zone")).toBeNull();
  });
});

describe("a zone a device reports", () => {
  it("is kept under the name the runtime knows it by", () => {
    expect(canonicalZone(EASTERN)).toBe(EASTERN);
    expect(canonicalZone("america/new_york")).toBe(EASTERN);
    expect(canonicalZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it.each([
    [""],
    ["Not/A_Zone"],
    ["Eastern"],
    [`America/${"x".repeat(64)}`],
  ])("is refused when it isn't one: %j", (zone) => {
    expect(canonicalZone(zone)).toBeNull();
  });
});

describe("ESPN's day", () => {
  it("is labelled by its own date, whatever the zone", () => {
    expect(espnDayLabel("2026-11-11")).toBe("Wed Nov 11");
    expect(espnDayLabel("2027-03-14")).toBe("Sun Mar 14");
  });

  it("is named only where the device's date isn't ESPN's day", () => {
    expect(countsForEspnDay(AFTER_MIDNIGHT_EAST, EASTERN, "2026-11-11")).toBe("Wed Nov 11");
    expect(countsForEspnDay(AFTER_MIDNIGHT_EAST, PACIFIC, "2026-11-11")).toBeNull();
    expect(
      countsForEspnDay(new Date("2026-11-12T03:00:00.000Z"), EASTERN, "2026-11-11")
    ).toBeNull();
  });

  it("changes at midnight Pacific, said in the device's zone", () => {
    expect(espnDayChangeTime(AFTER_MIDNIGHT_EAST, EASTERN)).toBe("3:00 AM ET");
    expect(espnDayChangeTime(AFTER_MIDNIGHT_EAST, PACIFIC)).toBe("12:00 AM PT");
    // The night daylight time ends, Eastern falls back an hour before Pacific does, so midnight
    // Pacific (still daylight time, 07:00 UTC) is 2:00 AM Eastern.
    expect(espnDayChangeTime(new Date("2026-11-01T05:00:00.000Z"), EASTERN)).toBe("2:00 AM ET");
  });

  it("changes at 4:00 AM Eastern the night daylight time starts", () => {
    // Eastern springs forward an hour before Pacific does, so midnight Pacific (still standard
    // time, 08:00 UTC) is 4:00 AM Eastern.
    expect(espnDayChangeTime(new Date("2027-03-14T05:00:00.000Z"), EASTERN)).toBe("4:00 AM ET");
  });
});
