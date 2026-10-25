import { z } from "zod";
import {
  injuryDesignations,
  type LineupPlayer,
  type LineupSlot,
  type LineupSlotName,
  lineupSlotNames,
  type PlayerDesignation,
  type TeamLineup,
} from "./contracts";
import { EspnError } from "./errors";

// One request returns every team's lineup: rosters, slot counts, team names and status.
export const LINEUP_VIEWS = ["mRoster", "mSettings", "mStatus", "mTeam"] as const;

const BENCH_SLOT = lineupSlotNames.indexOf("BE");
const IR_SLOT = lineupSlotNames.indexOf("IR");

// Each read parses its response with its own schema: the fields that read uses, plus the shared
// base below. The capture trims a recording with that same schema. The one transform, the day
// schema's filter on day lines, changes nothing when run on its own output, so a trimmed body
// parses again unchanged. A player's name is `fullName` only: one rostered player's first name
// equals a league member's.

// What every league response carries, for a read's result to describe itself (ReadMeta). It also
// holds the season's first and final scoring periods, which only the week read uses.
export const leagueBaseShape = {
  seasonId: z.number().int(),
  scoringPeriodId: z.number().int(),
  status: z.object({
    currentMatchupPeriod: z.number().int(),
    firstScoringPeriod: z.number().int().optional(),
    finalScoringPeriod: z.number().int().optional(),
  }),
};

export type LeagueBase = {
  seasonId: number;
  scoringPeriodId: number;
  status: { currentMatchupPeriod: number };
};

const lineupPlayerSchema = z.object({
  fullName: z.string(),
  proTeamId: z.number().int(),
  eligibleSlots: z.array(z.number().int()),
  injuryStatus: z.string().optional(),
});

const rosterEntrySchema = z.object({
  playerId: z.number().int(),
  lineupSlotId: z.number().int(),
  playerPoolEntry: z.object({ lineupLocked: z.boolean(), player: lineupPlayerSchema }),
});

const teamSchema = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  roster: z.object({ entries: z.array(rosterEntrySchema) }).optional(),
});

export const lineupResponseSchema = z.object({
  ...leagueBaseShape,
  settings: z
    .object({
      rosterSettings: z.object({ lineupSlotCounts: z.record(z.string(), z.number().int()) }),
    })
    .optional(),
  teams: z.array(teamSchema).optional(),
});

export type LineupResponse = z.infer<typeof lineupResponseSchema>;
type LeagueTeam = z.infer<typeof teamSchema>;
type RosterEntry = z.infer<typeof rosterEntrySchema>;

function unrecognized(message: string, cause?: Error): EspnError {
  return new EspnError("unrecognized_response", message, cause ? { cause } : {});
}

export function parseResponse<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  readName: string
): z.output<Schema> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue?.path.join(".") || "the response";
  throw unrecognized(
    `ESPN's league response isn't readable at ${where}: ${issue?.message ?? "invalid"} (reading ${readName})`,
    parsed.error
  );
}

function describePlayer(entry: RosterEntry): string {
  return `${entry.playerPoolEntry.player.fullName} (${entry.playerId})`;
}

export function slotNameOf(slotId: number, where: string): LineupSlotName {
  const name = lineupSlotNames[slotId];
  if (name === undefined) throw unrecognized(`unrecognized lineup slot ${slotId} for ${where}`);
  return name;
}

function designationOf(raw: string | undefined): PlayerDesignation {
  const known = injuryDesignations.find((designation) => designation === raw);
  return known ? { status: known } : { status: "unrecognized", raw: raw ?? null };
}

function playerOf(entry: RosterEntry, teamId: number): LineupPlayer {
  const where = `team ${teamId}, player ${describePlayer(entry)}`;
  const { player, lineupLocked } = entry.playerPoolEntry;
  return {
    playerId: entry.playerId,
    name: player.fullName,
    proTeamId: player.proTeamId,
    eligibleSlots: player.eligibleSlots.map((slotId) => slotNameOf(slotId, where)),
    designation: designationOf(player.injuryStatus),
    lineupLocked,
  };
}

// The league's slots in slot-id order, each filled by the players ESPN placed in it and padded
// with empty slots. A player in a slot the league doesn't use makes the lineup unreadable; the
// read never moves or drops a player (FM4).
function slotsOf(
  teamId: number,
  entries: readonly RosterEntry[],
  slotCounts: Record<string, number>
) {
  const used = Object.entries(slotCounts)
    .map(([slotId, count]) => ({ slotId: Number(slotId), count }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => a.slotId - b.slotId);
  for (const entry of entries) {
    if (!used.some(({ slotId }) => slotId === entry.lineupSlotId)) {
      throw unrecognized(
        `unrecognized lineup slot ${entry.lineupSlotId} for team ${teamId}, player ${describePlayer(entry)}`
      );
    }
  }
  return used.flatMap(({ slotId, count }) => {
    const slot = slotNameOf(slotId, `team ${teamId}`);
    const occupants = entries.filter((entry) => entry.lineupSlotId === slotId);
    if (occupants.length > count) {
      throw unrecognized(
        `team ${teamId} has ${occupants.length} players in ${slot}, which holds ${count}`
      );
    }
    const filled: LineupSlot[] = occupants.map((entry) => ({
      slot,
      player: playerOf(entry, teamId),
    }));
    const empties: LineupSlot[] = Array.from({ length: count - occupants.length }, () => ({
      slot,
      player: null,
    }));
    return [...filled, ...empties].map((lineupSlot) => ({ slotId, lineupSlot }));
  });
}

function lineupOf(
  team: LeagueTeam,
  slotCounts: Record<string, number>,
  readName: string
): TeamLineup {
  if (team.name === undefined || team.roster === undefined) {
    throw unrecognized(`team ${team.id} has no name or roster (reading ${readName})`);
  }
  const slots = slotsOf(team.id, team.roster.entries, slotCounts);
  const pick = (test: (slotId: number) => boolean) =>
    slots.filter(({ slotId }) => test(slotId)).map(({ lineupSlot }) => lineupSlot);
  return {
    teamId: team.id,
    teamName: team.name,
    starters: pick((slotId) => slotId !== BENCH_SLOT && slotId !== IR_SLOT),
    bench: pick((slotId) => slotId === BENCH_SLOT),
    injuredReserve: pick((slotId) => slotId === IR_SLOT),
  };
}

export function lineupsOf(league: LineupResponse, readName: string): TeamLineup[] {
  const slotCounts = league.settings?.rosterSettings.lineupSlotCounts;
  if (slotCounts === undefined || league.teams === undefined) {
    throw unrecognized(`ESPN's league response has no slot counts or teams (reading ${readName})`);
  }
  return league.teams.map((team) => lineupOf(team, slotCounts, readName));
}
