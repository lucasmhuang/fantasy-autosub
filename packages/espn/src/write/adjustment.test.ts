import { describe, expect, it } from "vitest";
import type { Matchup, MatchupSide } from "../read/contracts";
import { buildScheduleAdjustment } from "./adjustment";

function side(teamId: number, adjustment: number, adjustmentReason: string | null): MatchupSide {
  return { teamId, score: 1100.5, adjustment, adjustmentReason, creditedPlayers: [] };
}

const matchup: Matchup = {
  matchupId: 12,
  home: side(8, 2.4, "Injury sub requested Mon 10/27: A for B, +2.4"),
  away: side(3, -1.5, null),
};

describe("buildScheduleAdjustment", () => {
  // The shape of the 2026-10-29 schedule write ESPN applied: both sides, then the matchup id.
  it("sets the team's side to the target, in points, and sends the opponent's side unchanged", () => {
    const body = buildScheduleAdjustment({
      matchup,
      teamId: 8,
      targetTenths: 75,
      reason: "Injury sub requested Mon 10/27: A for B, +2.4; Tue 10/28: C for D, +5.1",
    });

    expect(body).toEqual([
      {
        id: 12,
        home: {
          teamId: 8,
          adjustment: 7.5,
          adjustmentReason:
            "Injury sub requested Mon 10/27: A for B, +2.4; Tue 10/28: C for D, +5.1",
        },
        away: { teamId: 3, adjustment: -1.5, adjustmentReason: "" },
      },
    ]);
  });

  it("writes the away side when the team plays away", () => {
    const body = buildScheduleAdjustment({ matchup, teamId: 3, targetTenths: -32, reason: "r" });

    expect(body[0]).toEqual({
      id: 12,
      home: {
        teamId: 8,
        adjustment: 2.4,
        adjustmentReason: "Injury sub requested Mon 10/27: A for B, +2.4",
      },
      away: { teamId: 3, adjustment: -3.2, adjustmentReason: "r" },
    });
  });

  it("refuses a matchup with one side, or one the team isn't in", () => {
    expect(() =>
      buildScheduleAdjustment({
        matchup: { ...matchup, away: null },
        teamId: 8,
        targetTenths: 10,
        reason: "r",
      })
    ).toThrow(RangeError);
    expect(() =>
      buildScheduleAdjustment({ matchup, teamId: 5, targetTenths: 10, reason: "r" })
    ).toThrow(RangeError);
  });
});
