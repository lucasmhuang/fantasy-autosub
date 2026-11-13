import type { SideAdjustment } from "../read/contracts";
import type { AdjustmentWrite, ScheduleAdjustmentBody, ScheduleSideBody } from "./contracts";

// ESPN keeps one adjustment and one reason per side, and a schedule write sets both sides, so the
// opponent's side goes back exactly as it was read (no reason is ESPN's empty string).
function sideBody(side: SideAdjustment, write: AdjustmentWrite): ScheduleSideBody {
  if (side.teamId !== write.teamId) {
    return {
      teamId: side.teamId,
      adjustment: side.adjustment,
      adjustmentReason: side.adjustmentReason ?? "",
    };
  }
  return {
    teamId: side.teamId,
    adjustment: write.targetTenths / 10,
    adjustmentReason: write.reason,
  };
}

// The schedule write ESPN applied on 2026-10-29: the matchup with both sides, the team's set to
// its target. A matchup with one side (a bye, the playoffs' lower bracket) is the commissioner's.
export function buildScheduleAdjustment(write: AdjustmentWrite): ScheduleAdjustmentBody {
  const { matchup, teamId } = write;
  if (matchup.away === null) {
    throw new RangeError(
      `Matchup ${matchup.matchupId} has one side, so its adjustment isn't automated`
    );
  }
  if (matchup.home.teamId !== teamId && matchup.away.teamId !== teamId) {
    throw new RangeError(`Team ${teamId} isn't in matchup ${matchup.matchupId}`);
  }
  return [
    {
      id: matchup.matchupId,
      home: sideBody(matchup.home, write),
      away: sideBody(matchup.away, write),
    },
  ];
}
