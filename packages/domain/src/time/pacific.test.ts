import { describe, expect, it } from "vitest";
import { formatPacificMoment } from "./pacific";

describe("formatPacificMoment", () => {
  it("writes a moment in Pacific time, labelled PT, across daylight saving's end", () => {
    expect(formatPacificMoment(new Date("2026-11-15T21:00:00.000Z"))).toBe(
      "Sun, 11/15, 1:00 PM PT"
    );
    expect(formatPacificMoment(new Date("2026-10-28T02:10:00.000Z"))).toBe(
      "Tue, 10/27, 7:10 PM PT"
    );
  });
});
