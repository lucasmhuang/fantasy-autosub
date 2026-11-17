import { describe, expect, it } from "vitest";
import { filingDays } from "./filing-days";

// ESPN's day 8 is today; the week holds days 7 to 13 (Mon Oct 26 to Sun Nov 1).
const week = { today: 8, days: [7, 8, 9, 10, 11, 12, 13] };

describe("the days a filing can name", () => {
  it("runs from the week's Monday to today in Pacific, today chosen", () => {
    // Tue Oct 27, 8 PM PDT.
    const now = new Date("2026-10-28T03:00:00Z");

    expect(filingDays(week, now, "America/Los_Angeles")).toEqual({
      options: [
        { value: "2026-10-26", label: "Mon Oct 26" },
        { value: "2026-10-27", label: "Tue Oct 27" },
      ],
      chosen: "2026-10-27",
      firstDate: "2026-10-26",
      lastDate: "2026-11-01",
    });
  });

  // Tue 11 PM PDT is already Wednesday in Eastern: the device's date, still ESPN's Tuesday.
  it("reaches the device's own date where it's already tomorrow", () => {
    const now = new Date("2026-10-28T06:00:00Z");

    expect(filingDays(week, now, "America/New_York")).toMatchObject({
      options: [
        { value: "2026-10-26", label: "Mon Oct 26" },
        { value: "2026-10-27", label: "Tue Oct 27" },
        { value: "2026-10-28", label: "Wed Oct 28" },
      ],
      chosen: "2026-10-28",
    });
  });

  // On the week's last day, in Eastern after midnight: one date past it, never two.
  it("stops one date past the week's last", () => {
    const lastDay = { today: 13, days: week.days };
    const now = new Date("2026-11-02T07:30:00Z");

    const { options, chosen } = filingDays(lastDay, now, "Asia/Tokyo");

    expect(options.at(-1)).toEqual({ value: "2026-11-02", label: "Mon Nov 2" });
    expect(chosen).toBe("2026-11-02");
  });
});
