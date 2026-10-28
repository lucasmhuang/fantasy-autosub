import { z } from "zod";
import type { DayLine, DayPlayer, TeamDay } from "./contracts";
import { EspnError } from "./errors";
import { leagueBaseShape, slotNameOf } from "./league";

// One request returns every team's lineup and day lines for one scoring period.
export const DAY_VIEWS = ["mRoster"] as const;

const COUNTED_STAT_IDS = ["0", "6", "3", "2", "1", "11"] as const;

// A player's actual stats for one day (statSplitTypeId 5, statSourceId 0), with only the six counted
// stat ids: 0 PTS, 6 REB, 3 AST, 2 STL, 1 BLK and 11 TO, checked against public box scores. A player
// whose team played but who recorded nothing gets a line with no stats at all (2026-10-25), so the
// stats are optional here and the day read decides.
const dayLineSchema = z.object({
  statSplitTypeId: z.literal(5),
  statSourceId: z.literal(0),
  scoringPeriodId: z.number().int(),
  appliedTotal: z.number(),
  stats: z.object({
    "0": z.number().optional(),
    "1": z.number().optional(),
    "2": z.number().optional(),
    "3": z.number().optional(),
    "6": z.number().optional(),
    "11": z.number().optional(),
  }),
});

function isDayLine(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "statSplitTypeId") === 5 &&
    Reflect.get(value, "statSourceId") === 0
  );
}

// The day read needs a player's slot, lock, name and day lines. ESPN also sends season,
// recent-days and projected splits, which it drops: filtering before validating, and filtering
// again changes nothing, so a trimmed body still parses unchanged.
const dayEntrySchema = z.object({
  playerId: z.number().int(),
  lineupSlotId: z.number().int(),
  playerPoolEntry: z.object({
    lineupLocked: z.boolean(),
    player: z.object({
      fullName: z.string(),
      stats: z
        .preprocess(
          (stats) => (Array.isArray(stats) ? stats.filter(isDayLine) : stats),
          z.array(dayLineSchema)
        )
        .optional(),
    }),
  }),
});

export const dayResponseSchema = z.object({
  ...leagueBaseShape,
  teams: z.array(
    z.object({
      id: z.number().int(),
      roster: z.object({ entries: z.array(dayEntrySchema) }).optional(),
    })
  ),
});

type DayResponse = z.infer<typeof dayResponseSchema>;
type DayEntry = z.infer<typeof dayEntrySchema>;
type DayLineStats = z.infer<typeof dayLineSchema>;

// No counted stats at all means the player recorded nothing that day (ESPN's form for a player who
// didn't play): no line. All six make a line. Some but not all is a shape ESPN hasn't been seen to
// send, so it's refused rather than read as zeros.
function lineOf(line: DayLineStats, where: string): DayLine | null {
  const missing = COUNTED_STAT_IDS.filter((id) => line.stats[id] === undefined);
  if (missing.length === COUNTED_STAT_IDS.length) return null;
  const {
    "0": points,
    "6": rebounds,
    "3": assists,
    "2": steals,
    "1": blocks,
    "11": turnovers,
  } = line.stats;
  if (
    points === undefined ||
    rebounds === undefined ||
    assists === undefined ||
    steals === undefined ||
    blocks === undefined ||
    turnovers === undefined
  ) {
    throw new EspnError(
      "unrecognized_response",
      `the day line for ${where} lacks stat ids ${missing.join(", ")}`
    );
  }
  return {
    fantasyPoints: line.appliedTotal,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
  };
}

function dayPlayerOf(entry: DayEntry, teamId: number, day: number): DayPlayer {
  const { player } = entry.playerPoolEntry;
  const slot = slotNameOf(
    entry.lineupSlotId,
    `team ${teamId}, player ${player.fullName} (${entry.playerId})`
  );
  const line = (player.stats ?? []).find((candidate) => candidate.scoringPeriodId === day);
  return {
    playerId: entry.playerId,
    name: player.fullName,
    slot,
    active: slot !== "BE" && slot !== "IR",
    lineupLocked: entry.playerPoolEntry.lineupLocked,
    line: line
      ? lineOf(
          line,
          `team ${teamId}, player ${player.fullName} (${entry.playerId}), scoring period ${day}`
        )
      : null,
  };
}

// A team's lineup on one day (as played, or as set for a day to come), with each player's line
// for that day. Bench and IR players are listed too.
export function teamDayOf(
  league: DayResponse,
  teamId: number,
  day: number,
  readName: string
): TeamDay {
  const team = league.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new EspnError("team_not_found", `team ${teamId} isn't in this league`);
  if (!team.roster) {
    throw new EspnError(
      "unrecognized_response",
      `ESPN sent no roster for team ${teamId} on scoring period ${day} (reading ${readName})`
    );
  }
  return {
    teamId,
    scoringPeriodId: day,
    players: team.roster.entries.map((entry) => dayPlayerOf(entry, teamId, day)),
  };
}
