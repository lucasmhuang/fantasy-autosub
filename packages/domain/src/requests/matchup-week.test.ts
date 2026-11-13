import { describe, expect, it } from "vitest";
import { hasMatchupEnded, isMatchupWeekOver, isPlayoffPeriod } from "./matchup-week";

const days = [7, 8, 9, 10, 11, 12, 13];

describe("hasMatchupEnded", () => {
  const request = { season: 2027, matchupPeriodId: 2 };
  const espnOn = (
    season: number,
    matchupPeriodId: number,
    today: number,
    scoringPeriodIds = days
  ) => ({
    season,
    week: { matchupPeriodId, todayScoringPeriodId: today, scoringPeriodIds },
  });

  it("is still on while ESPN's week is the request's and its last day hasn't passed", () => {
    expect(hasMatchupEnded(request, espnOn(2027, 2, 13))).toBe(false);
  });

  it("has ended once ESPN's week is a later one", () => {
    expect(hasMatchupEnded(request, espnOn(2027, 3, 14, [14, 15, 16, 17, 18, 19, 20]))).toBe(true);
  });

  it("has ended once ESPN's day is past the request's week, as after the season", () => {
    expect(hasMatchupEnded(request, espnOn(2027, 2, 14))).toBe(true);
  });

  it("has ended for a request from an earlier season, and not for a later one", () => {
    expect(hasMatchupEnded(request, espnOn(2028, 2, 8))).toBe(true);
    expect(hasMatchupEnded({ season: 2028, matchupPeriodId: 2 }, espnOn(2027, 2, 14))).toBe(false);
  });
});

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
