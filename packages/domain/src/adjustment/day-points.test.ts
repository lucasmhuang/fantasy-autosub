import { describe, expect, it } from "vitest";
import { playerDayPoints } from "./day-points";

const line = (fantasyPoints: number) => ({ fantasyPoints });
const days = [
  {
    scoringPeriodId: 7,
    players: [
      { playerId: 1, active: true, line: line(40.4) },
      { playerId: 2, active: false, line: line(27) },
    ],
  },
  {
    scoringPeriodId: 8,
    players: [
      { playerId: 1, active: true, line: null },
      { playerId: 2, active: true, line: line(12.4) },
    ],
  },
];

describe("playerDayPoints", () => {
  it("gives a player's points on each day he has a line, in tenths, active or not", () => {
    expect(playerDayPoints(days, 2, false)).toEqual([
      { day: 7, tenths: 270 },
      { day: 8, tenths: 124 },
    ]);
  });

  it("keeps only the days he was in an active slot when asked for credited days", () => {
    expect(playerDayPoints(days, 2, true)).toEqual([{ day: 8, tenths: 124 }]);
  });

  it("skips a day with no line, and a player not on the roster", () => {
    expect(playerDayPoints(days, 1, true)).toEqual([{ day: 7, tenths: 404 }]);
    expect(playerDayPoints(days, 3, false)).toEqual([]);
  });
});
