import { describe, expect, it } from "vitest";
import { isMatchupWeekOver, isPlayoffPeriod } from "./matchup-week";

const days = [7, 8, 9, 10, 11, 12, 13];

describe("isMatchupWeekOver", () => {
  it("is over once ESPN's day is past the week's last day, as after the season", () => {
    expect(isMatchupWeekOver({ todayScoringPeriodId: 14, scoringPeriodIds: days })).toBe(true);
  });

  it("isn't over on the week's last day, whose games may still be on", () => {
    expect(isMatchupWeekOver({ todayScoringPeriodId: 13, scoringPeriodIds: days })).toBe(false);
  });
});

describe("isPlayoffPeriod", () => {
  it("counts the league's 18 regular-season matchups as before the playoffs, and 19 on as playoffs", () => {
    expect(isPlayoffPeriod(18)).toBe(false);
    expect(isPlayoffPeriod(19)).toBe(true);
  });
});
