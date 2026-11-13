import type { DayPoints } from "./compute";
import { toTenths } from "./points";

// A team's day as ESPN's day reads give it: each rostered player's slot and line.
export type PlayedDay = {
  scoringPeriodId: number;
  players: readonly { playerId: number; active: boolean; line: { fantasyPoints: number } | null }[];
};

// A player's points on each day he has a line, in tenths: every day for the replacement's bench
// points, or only the days he was in an active slot for what ESPN credited a starter.
export function playerDayPoints(
  days: readonly PlayedDay[],
  playerId: number,
  activeOnly: boolean
): DayPoints[] {
  return days.flatMap((day) => {
    const player = day.players.find((each) => each.playerId === playerId);
    if (!player?.line || (activeOnly && !player.active)) return [];
    return [{ day: day.scoringPeriodId, tenths: toTenths(player.line.fantasyPoints) }];
  });
}
