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

// A player ESPN credits to the side this week, with his week-to-date points, today's live points
// included. ESPN lists a player only once he has points for the side, so early in the week a side
// lists fewer players than it has starters, and it gives no lineup slot here. Whether a total also
// counts days he was benched hasn't been seen either way, so what counted for his team has to come
// from the day lines.
export type CreditedPlayer = { playerId: number; weekToDatePoints: number };

// The score is ESPN's, for the side's complete days: today's in-progress points aren't in it.
export type MatchupSide = {
  teamId: number;
  score: number;
  adjustment: number;
  creditedPlayers: readonly CreditedPlayer[];
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

// The cookies are the configured member's, the league owner's (FM1). A failed check throws.
export type CredentialCheck = { ok: true; source: "live" | "recorded" };

// A league rule on ESPN that differs from the one InjurySub computes with (FM6): a setting, or a
// played day's line whose ESPN points the league formula doesn't reproduce.
export type RuleMismatch =
  | { kind: "setting"; setting: string; expected: string; espn: string }
  | {
      kind: "day-points";
      teamId: number;
      playerId: number;
      name: string;
      scoringPeriodId: number;
      formulaPoints: number;
      espnPoints: number;
    };

export type LeagueRulesRead = { meta: ReadMeta; mismatches: readonly RuleMismatch[] };

// An NBA game, from one team's side: when it starts, and against whom.
export type ProGame = {
  scoringPeriodId: number;
  date: string;
  opponentProTeamId: number;
  opponent: string;
  home: boolean;
};

// A rostered player's outlook for the current week (FS6).
export type PlayerOutlook = {
  playerId: number;
  name: string;
  proTeamId: number;
  // ESPN's season average for the league's season (0 before his first game), or null when ESPN
  // has no entry for the season.
  seasonAveragePoints: number | null;
  // His lines on the week's complete days, summed, whatever his slot. creditedPoints is the part
  // from days he was in an active slot, which counted for his team.
  weekToDate: DayLine;
  creditedPoints: number;
  // His NBA team's games from today through the week's last day; today's count until ESPN's day
  // ends. The next game is the first from today on, this week or later.
  gamesLeft: number;
  nextGame: ProGame | null;
};

export type PlayerOutlookRead = {
  meta: ReadMeta;
  teamId: number;
  players: readonly PlayerOutlook[];
};

export interface EspnReadClient {
  getLineups(): Promise<LineupsRead>;
  getLineup(teamId: number): Promise<LineupRead>;
  getCurrentWeek(): Promise<CurrentWeekRead>;
  getTeamDay(teamId: number, scoringPeriodId: number): Promise<TeamDayRead>;
  checkCredentials(): Promise<CredentialCheck>;
  // The settings, and the current week's complete days, against the PRD's rules.
  checkLeagueRules(): Promise<LeagueRulesRead>;
  getPlayerOutlook(teamId: number): Promise<PlayerOutlookRead>;
}
