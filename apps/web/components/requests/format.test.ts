import { describe, expect, it } from "vitest";
import { formatNextGame, formatReadTime } from "./format";

describe("formatNextGame", () => {
  it("names an evening game by its Pacific day, though its UTC date is the next day", () => {
    const game = { date: "2026-10-29T00:00:00.000Z", opponent: "BOS", home: true };

    expect(formatNextGame(game)).toBe("Wed 5:00 PM PT vs BOS");
  });

  it("marks an away game", () => {
    const game = { date: "2026-11-04T03:30:00.000Z", opponent: "DEN", home: false };

    expect(formatNextGame(game)).toBe("Tue 7:30 PM PT @ DEN");
  });

  it("says when there's no game ahead", () => {
    expect(formatNextGame(null)).toBe("No game scheduled");
  });
});

describe("formatReadTime", () => {
  it("gives the read's time in Pacific", () => {
    expect(formatReadTime("2026-11-06T02:05:00.000Z")).toBe("Thu 6:05 PM PT");
  });
});
