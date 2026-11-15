import { describe, expect, it } from "vitest";
import { pacificDaysBetween } from "./pacific-time";

describe("pacificDaysBetween", () => {
  it("counts Pacific calendar days, so one minute across Pacific midnight is a day", () => {
    const lateEvening = new Date("2026-10-28T06:59:00Z"); // Oct 27, 23:59 PDT
    const justAfter = new Date("2026-10-28T07:00:00Z"); // Oct 28, 00:00 PDT
    expect(pacificDaysBetween(lateEvening, justAfter)).toBe(1);
    expect(pacificDaysBetween(justAfter, new Date("2026-10-29T06:00:00Z"))).toBe(0);
  });
});
