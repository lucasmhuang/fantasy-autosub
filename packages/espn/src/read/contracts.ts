// What the ESPN reads return. Read models are plain data; the client contract is an interface.

// ESPN's lineup slot ids, by index: 0 PG to 4 C, the combo slots, then UTIL, bench and IR.
export const lineupSlotNames = [
  "PG",
  "SG",
  "SF",
  "PF",
  "C",
  "G",
  "F",
  "SG/SF",
  "G/F",
  "PF/C",
  "F/C",
  "UTIL",
  "BE",
  "IR",
] as const;
export type LineupSlotName = (typeof lineupSlotNames)[number];

export const injuryDesignations = ["ACTIVE", "DAY_TO_DAY", "OUT", "SUSPENSION"] as const;
export type InjuryDesignation = (typeof injuryDesignations)[number];

// A designation ESPN sends that isn't one of the known ones is kept as sent, never mapped to a
// known one (FM4); `raw` is null when ESPN sent none.
export type PlayerDesignation =
  | { status: InjuryDesignation }
  | { status: "unrecognized"; raw: string | null };

export type LineupPlayer = {
  playerId: number;
  name: string;
  proTeamId: number;
  eligibleSlots: readonly LineupSlotName[];
  designation: PlayerDesignation;
  lineupLocked: boolean;
};

// An empty slot has no player.
export type LineupSlot = { slot: LineupSlotName; player: LineupPlayer | null };

export type TeamLineup = {
  teamId: number;
  teamName: string;
  starters: readonly LineupSlot[];
  bench: readonly LineupSlot[];
  injuredReserve: readonly LineupSlot[];
};

// Where a read's data came from and what it describes, so a later step can store it as is.
export type ReadMeta = {
  source: "live" | "recorded";
  season: number;
  matchupPeriodId: number;
  scoringPeriodId: number;
  readAt: string;
  capturedAt?: string;
};

export type LineupsRead = { meta: ReadMeta; teams: readonly TeamLineup[] };

export type LineupRead = { meta: ReadMeta; team: TeamLineup };

// A starter's week-to-date points are ESPN's total for the player, today's live points included.
// It may also count days he was benched (not yet seen either way), so what counted for his team
// has to come from the day lines.
export type MatchupStarter = { playerId: number; slot: LineupSlotName; weekToDatePoints: number };

// The score is ESPN's, for the side's complete days: today's in-progress points aren't in it.
export type MatchupSide = {
  teamId: number;
  score: number;
  adjustment: number;
  starters: readonly MatchupStarter[];
};

export type Matchup = { matchupId: number; home: MatchupSide; away: MatchupSide | null };

// Scoring periods are days, numbered as ESPN numbers them. Complete days run from the week's
// first day through yesterday; today's games may still be in progress, so today is apart.
export type MatchupWeek = {
  matchupPeriodId: number;
  scoringPeriodIds: readonly number[];
  completeScoringPeriodIds: readonly number[];
  todayScoringPeriodId: number;
  matchups: readonly Matchup[];
};

export type CurrentWeekRead = { meta: ReadMeta; week: MatchupWeek };

// One player's stats for one day, with ESPN's own fantasy points for them.
export type DayLine = {
  fantasyPoints: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
};

// A player has a line only for a day his NBA team played and ESPN sent stats for him (none when he
// recorded nothing); bench players have lines too.
export type DayPlayer = {
  playerId: number;
  name: string;
  slot: LineupSlotName;
  active: boolean;
  // Whether his slot that day can still change: every past day is locked, and today and later
  // days follow the weekly lock (a player locks at his first game of the week).
  lineupLocked: boolean;
  line: DayLine | null;
};

export type TeamDay = { teamId: number; scoringPeriodId: number; players: readonly DayPlayer[] };

export type TeamDayRead = { meta: ReadMeta; day: TeamDay };

export interface EspnReadClient {
  getLineups(): Promise<LineupsRead>;
  getLineup(teamId: number): Promise<LineupRead>;
  getCurrentWeek(): Promise<CurrentWeekRead>;
  getTeamDay(teamId: number, scoringPeriodId: number): Promise<TeamDayRead>;
}
