import {
  describeFailure,
  isDatabaseQueryError,
  type LeagueSettings,
  listActiveTeamRequests,
  listTeamNames,
  readLeagueSettings,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  classifyReplacementOptions,
  inFlightRequestNaming,
  isAfterFinalGame,
  isMatchupWeekOver,
  isPlayoffPeriod,
  type LineupEdit,
  optionHoldFor,
  planLineupEdit,
  type ReplacementOption,
  requestAmountTenths,
  type SubRequestStatus,
  toTenths,
  writeGateFor,
} from "@injurysub/domain";
import {
  type DayLine,
  EspnError,
  type EspnErrorCode,
  type GameState,
  type LineupPlayer,
  type LineupSlot,
  type MatchupSide,
  type PlayerDesignation,
  type PlayerOutlook,
  type ProGame,
  type TeamWeekRead,
} from "@injurysub/espn";
import { getWebDatabaseConnection } from "./db";
import { getWebEspn } from "./espn";
import { getWebLogger } from "./logger";
import { pacificCalendarDate } from "./pacific-time";

export type OptionStatus = "ready_now" | "review_required" | "not_valid";
export type OptionReason = "other_starters_move" | "suspension" | "no_valid_lineup" | "taken";
export type OptionWarning = "no_games_left" | "already_scored";

export type BoardLineupSlot = { slot: string; playerId: number | null; name: string | null };

// The lineup edit an option makes, each move named, in the order sent: the injured starter to the
// bench, any other starter's move, then the replacement from the bench (Dec-D28, R22, R23).
export type BoardEditItem = { playerId: number; name: string; fromSlot: string; toSlot: string };
export type BoardEdit = { items: BoardEditItem[]; movedStarters: number };

// gameState is his NBA game's state today from ESPN's scoreboard, or null: no game today, or the
// scoreboard unread, when only the tip time can be shown (FM-BOARD-9).
export type BoardOption = {
  playerId: number;
  name: string;
  proTeam: string;
  position: string;
  gameState: GameState | null;
  status: OptionStatus;
  reason: OptionReason | null;
  // For a taken option: the starter of the request still in flight that names him (Dec-D30).
  takenFor: string | null;
  edit: BoardEdit | null;
  warnings: OptionWarning[];
  gamesLeft: number;
  todaysGame: ProGame | null;
  nextGame: ProGame | null;
  // His NBA team's games this week from today on, and his fantasy points this week so far.
  upcomingGames: ProGame[];
  weekPoints: number;
  seasonAveragePoints: number | null;
  lineup: BoardLineupSlot[] | null;
};

export type BoardRequest = {
  requestId: string;
  status: SubRequestStatus;
  injuredName: string;
  replacementName: string;
  filedAt: Date;
  // What the adjustment is or would be (domain's requestAmountTenths); null with none.
  amountTenths: number | null;
};

// A day he started and played, by ESPN's day and its calendar date, with his points that day.
export type StartingDay = { scoringPeriodId: number; date: string | null; points: number };

export type OptionCounts = { readyNow: number; review: number; notValid: number };

export type BoardStarter = {
  playerId: number;
  name: string;
  proTeam: string;
  position: string;
  gameState: GameState | null;
  slot: string;
  designation: "OUT" | "SUSPENSION";
  // His lines this matchup week, today's live one included, whatever his slot.
  weekToDate: DayLine;
  // What a substitution would cost him: his points in active slots this week, today's included
  // (behaviors D1, OQ26).
  forfeitTenths: number;
  // His NBA team's game today, and its next game from today on.
  todaysGame: ProGame | null;
  nextGame: ProGame | null;
  startingDays: StartingDay[];
  request: BoardRequest | null;
  options: BoardOption[];
  hiddenOptionCount: number;
  // Every option, shown or hidden, by how it would go.
  optionCounts: OptionCounts;
};

// A side's ESPN total for the complete days, with its points today beside it (live, or null when
// the read had none: before today's games, or from an older worker).
export type BoardSide = {
  teamId: number;
  name: string | null;
  total: number;
  livePoints: number | null;
};

export type BoardMatchup = { mine: BoardSide; opponent: BoardSide | null };

// The matchup week: its number, its Monday and Sunday as calendar dates (null if no game this
// week dates them), and whether its final game is over.
export type BoardWeek = {
  matchupPeriodId: number;
  playoffs: boolean;
  firstDate: string | null;
  lastDate: string | null;
  afterLastGame: boolean;
  // No player on the team has a line yet this week.
  beforeFirstGame: boolean;
  // ESPN's day now.
  today: number;
  // Each ESPN day of the week with its calendar date (null if no game dates the week).
  days: { scoringPeriodId: number; date: string | null }[];
};

// How a Ready option would go for this team under the league's settings: at once, once the
// commissioner approves, or made by them (automation off, the team not allowed, a playoff week or
// a bye), as `routeRequest` would route it.
export type ReadyRoute = "now" | "approval" | "commissioner";

export type BoardRosterPlayer = {
  playerId: number;
  name: string;
  proTeam: string;
  position: string;
  designation: PlayerDesignation["status"];
  gameState: GameState | null;
  todaysGame: ProGame | null;
  nextGame: ProGame | null;
  // His fantasy points this week, every slot and today's live line included.
  weekPoints: number;
  seasonAveragePoints: number | null;
};

export type BoardRosterRow = { slot: string; player: BoardRosterPlayer | null };

export type BoardRoster = {
  starters: BoardRosterRow[];
  bench: BoardRosterRow[];
  injuredReserve: BoardRosterRow[];
};

// The board as built from one read of the team and its requests.
// A board was read (fresh or stale), as opposed to a reason there's none.
export function isLoadedBoard<T extends { status: string }>(
  board: T
): board is Extract<T, { status: "board" }> {
  return board.status === "board";
}

// worker_down: InjurySub's own service didn't answer; database_down: its database didn't. A
// stale board is the team's last read, shown while ESPN can't be reached (FM-BOARD-1).
export type BuiltBoard =
  | {
      status:
        | "not_connected"
        | "unavailable"
        | "credentials_rejected"
        | "season_over"
        | "worker_down"
        | "database_down";
    }
  | {
      status: "board";
      teamId: number;
      teamName: string;
      readAt: string;
      stale: boolean;
      headline: string;
      week: BoardWeek;
      matchup: BoardMatchup | null;
      roster: BoardRoster;
      outStarters: BoardStarter[];
      suspendedStarters: BoardStarter[];
    };

export type FoundBoard = Extract<BuiltBoard, { status: "board" }>;

// The board as its page shows it. The worker's bar is the shell's (loadShell).
export type TeamBoard =
  | Exclude<BuiltBoard, { status: "board" }>
  | (FoundBoard & { readyRoute: ReadyRoute });

const NO_OUT_STARTER =
  "None of your starters are currently listed as OUT. If this just changed, give ESPN a few minutes to update and refresh.";
const BASE_POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const DAY_MS = 86_400_000;
const STATUS_ORDER: Record<OptionStatus, number> = {
  ready_now: 0,
  review_required: 1,
  not_valid: 2,
};
const NO_LINE: DayLine = {
  fantasyPoints: 0,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
};

// What the board is built from: the read, and the team's requests this matchup.
type BoardContext = {
  read: TeamWeekRead;
  outlooks: ReadonlyMap<number, PlayerOutlook>;
  names: ReadonlyMap<number, string>;
  requestsByInjured: ReadonlyMap<number, SubRequestRecord>;
  requests: readonly SubRequestRecord[];
  // Today's NBA games by each of their two teams' ids.
  gameStates: ReadonlyMap<number, GameState>;
  // Each of the week's ESPN days by its calendar date.
  dates: ReadonlyMap<number, string>;
};

// Each team's last good read, shown marked stale while ESPN can't be reached. One web process
// holds it, so a deploy forgets it.
const lastReads = new Map<number, TeamWeekRead>();

export function forgetLastReads(): void {
  lastReads.clear();
}

// A team's board as of ESPN's state now (OQ5: the read time is shown; Confirm re-checks): each
// OUT starter with his week and his options, suspended starters apart (OQ19), and the starter's
// request instead of options while one holds him (D14).
export async function loadTeamBoard(input: {
  teamId: number;
  revealAll: boolean;
}): Promise<TeamBoard> {
  const found = await boardRead(input.teamId);
  if ("status" in found) return found;
  const { read, stale } = found;
  if (isMatchupWeekOver(read.week)) return { status: "season_over" };

  try {
    const { db } = getWebDatabaseConnection();
    const [requests, settings, gameStates, storedNames] = await Promise.all([
      listActiveTeamRequests(db, {
        season: read.meta.season,
        matchupPeriodId: read.week.matchupPeriodId,
        teamId: input.teamId,
      }),
      readLeagueSettings(db),
      stale ? new Map<number, GameState>() : readTodaysGameStates(read),
      listTeamNames(db),
    ]);
    const board = withStoredNames(
      buildTeamBoard(read, requests, input.revealAll, gameStates),
      new Map(storedNames.map((team) => [team.teamId, team.name]))
    );
    return { ...board, stale, readyRoute: readyRouteFor(board, settings) };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.board.database_failed", undefined, {
      reason: describeFailure(error),
    });
    return { status: "database_down" };
  }
}

// FS-APP-14: each team by the name InjurySub stores, over the one this read gave.
function withStoredNames(board: FoundBoard, stored: ReadonlyMap<number, string>): FoundBoard {
  const named = (side: BoardSide): BoardSide => ({
    ...side,
    name: stored.get(side.teamId) ?? side.name,
  });
  const { matchup } = board;
  return {
    ...board,
    teamName: stored.get(board.teamId) ?? board.teamName,
    matchup:
      matchup === null
        ? null
        : { mine: named(matchup.mine), opponent: matchup.opponent && named(matchup.opponent) },
  };
}

export function readyRouteFor(board: FoundBoard, settings: LeagueSettings): ReadyRoute {
  const byHand = board.week.playoffs || board.matchup?.opponent === null;
  if (byHand || writeGateFor(settings.writeAllowlist, board.teamId) !== "open") {
    return "commissioner";
  }
  return settings.executionMode === "approval_required" ? "approval" : "now";
}

// The team's week, or its last good read (marked stale) while ESPN can't be reached.
async function boardRead(
  teamId: number
): Promise<{ read: TeamWeekRead; stale: boolean } | BoardUnreadable> {
  const fresh = await readBoardWeek(teamId);
  if (!("status" in fresh)) {
    lastReads.set(teamId, fresh);
    return { read: fresh, stale: false };
  }
  const last = fresh.status === "unavailable" ? lastReads.get(teamId) : undefined;
  return last === undefined ? fresh : { read: last, stale: true };
}

// The board's own read: a worker that doesn't answer is InjurySub's outage, never ESPN's (FM-BOARD-4).
async function readBoardWeek(teamId: number): Promise<TeamWeekRead | BoardUnreadable> {
  try {
    return await getWebEspn().getTeamWeek(teamId);
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.board.espn_failed", { code: error.code });
    if (error.code === "worker_unreachable") return { status: "worker_down" };
    return { status: espnFailureStatus(error.code) };
  }
}

type BoardUnreadable = { status: EspnUnavailable["status"] | "worker_down" };

export type EspnUnavailable = { status: "not_connected" | "credentials_rejected" | "unavailable" };

// The team's week from ESPN through the worker, or why it couldn't be read.
export async function readTeamWeek(teamId: number): Promise<TeamWeekRead | EspnUnavailable> {
  try {
    return await getWebEspn().getTeamWeek(teamId);
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.board.espn_failed", { code: error.code });
    return { status: espnFailureStatus(error.code) };
  }
}

// Today's NBA games by team, from ESPN's scoreboard (M1), asked once and only when someone on the
// team plays today. ESPN's day runs midnight to midnight Pacific, so the date asked is the Pacific
// date of today's tips, never a tip's UTC date. Unread, the board shows tip times (FM-BOARD-9).
async function readTodaysGameStates(read: TeamWeekRead): Promise<ReadonlyMap<number, GameState>> {
  const today = read.week.todayScoringPeriodId;
  const tip = read.players
    .flatMap((player) => player.weekGames)
    .find((game) => game.scoringPeriodId === today)?.date;
  if (tip === undefined) return new Map();
  try {
    const { games } = await getWebEspn().getGameStates(pacificCalendarDate(new Date(tip)));
    return new Map(
      games.flatMap((game) => [
        [game.homeProTeamId, game],
        [game.awayProTeamId, game],
      ])
    );
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.board.game_states_unread", { code: error.code });
    return new Map();
  }
}

// The board for a read and the team's live requests this matchup; without today's game states,
// each player's is null.
export function buildTeamBoard(
  read: TeamWeekRead,
  requests: SubRequestRecord[],
  revealAll: boolean,
  gameStates: ReadonlyMap<number, GameState> = new Map()
): FoundBoard {
  return boardFrom(contextOf(read, requests, gameStates), revealAll);
}

function espnFailureStatus(code: EspnErrorCode): EspnUnavailable["status"] {
  if (code === "not_connected" || code === "credentials_rejected") return code;
  return "unavailable";
}

function contextOf(
  read: TeamWeekRead,
  requests: SubRequestRecord[],
  gameStates: ReadonlyMap<number, GameState>
): BoardContext {
  const { starters, bench, injuredReserve } = read.lineup;
  const rostered = [...starters, ...bench, ...injuredReserve].flatMap(({ player }) =>
    player === null ? [] : [player]
  );
  return {
    read,
    outlooks: new Map(read.players.map((outlook) => [outlook.playerId, outlook])),
    names: new Map(rostered.map((player) => [player.playerId, player.name])),
    requestsByInjured: new Map(requests.map((request) => [request.injuredPlayerId, request])),
    requests,
    gameStates,
    dates: espnDayDates(read),
  };
}

// The week's ESPN days as calendar dates. ESPN's day runs midnight to midnight Pacific and its days
// are consecutive, so one game's Pacific date dates every day of the week.
function espnDayDates(read: TeamWeekRead): ReadonlyMap<number, string> {
  const anchor = read.players.flatMap((player) => player.weekGames)[0];
  if (anchor === undefined) return new Map();
  const anchorDay = Date.parse(`${pacificCalendarDate(new Date(anchor.date))}T00:00:00Z`);
  return new Map(
    read.week.scoringPeriodIds.map((day) => [
      day,
      new Date(anchorDay + (day - anchor.scoringPeriodId) * DAY_MS).toISOString().slice(0, 10),
    ])
  );
}

function boardFrom(context: BoardContext, revealAll: boolean): FoundBoard {
  const { read } = context;
  const starters = read.lineup.starters.flatMap((slot) => starterOf(context, slot, revealAll));
  const outStarters = starters.filter((each) => each.designation === "OUT");
  return {
    status: "board",
    teamId: read.teamId,
    teamName: read.lineup.teamName,
    readAt: read.meta.readAt,
    stale: false,
    headline: headlineFor(outStarters.length),
    week: weekOf(context),
    matchup: matchupOf(read),
    roster: rosterOf(context),
    outStarters,
    suspendedStarters: starters.filter((each) => each.designation === "SUSPENSION"),
  };
}

function weekOf({ read, dates }: BoardContext): BoardWeek {
  const { week } = read;
  const lastDay = Math.max(...week.scoringPeriodIds);
  return {
    matchupPeriodId: week.matchupPeriodId,
    playoffs: isPlayoffPeriod(week.matchupPeriodId),
    firstDate: dates.get(Math.min(...week.scoringPeriodIds)) ?? null,
    lastDate: dates.get(lastDay) ?? null,
    beforeFirstGame: read.days.every((day) => day.players.every((each) => each.line === null)),
    today: week.todayScoringPeriodId,
    days: week.scoringPeriodIds.map((day) => ({
      scoringPeriodId: day,
      date: dates.get(day) ?? null,
    })),
    afterLastGame: isAfterFinalGame(
      {
        day: week.todayScoringPeriodId,
        lastDay,
        lastDayLatestTipAt:
          read.lastDayLatestTipAt === null ? null : new Date(read.lastDayLatestTipAt),
      },
      new Date()
    ),
  };
}

function matchupOf(read: TeamWeekRead): BoardMatchup | null {
  const { matchup } = read;
  if (matchup === null) return null;
  const mineIsHome = matchup.home.teamId === read.teamId;
  const mine = mineIsHome ? matchup.home : matchup.away;
  if (mine === null) return null;
  const opponent = mineIsHome ? matchup.away : matchup.home;
  return {
    mine: sideOf(mine, read.lineup.teamName),
    opponent: opponent === null ? null : sideOf(opponent, null),
  };
}

function sideOf(side: MatchupSide, fallbackName: string | null): BoardSide {
  return {
    teamId: side.teamId,
    name: side.teamName ?? fallbackName,
    total: side.score,
    livePoints: side.livePoints ?? null,
  };
}

function rosterOf(context: BoardContext): BoardRoster {
  const rows = (slots: readonly LineupSlot[]) =>
    slots.map(({ slot, player }) => ({
      slot,
      player: player === null ? null : rosterPlayerOf(context, player),
    }));
  const { starters, bench, injuredReserve } = context.read.lineup;
  return { starters: rows(starters), bench: rows(bench), injuredReserve: rows(injuredReserve) };
}

function rosterPlayerOf(context: BoardContext, player: LineupPlayer): BoardRosterPlayer {
  const outlook = context.outlooks.get(player.playerId);
  return {
    ...describePlayer(context, player),
    designation: player.designation.status,
    ...gamesOf(context, outlook),
    weekPoints: weekPointsOf(context.read, player.playerId),
    seasonAveragePoints: outlook?.seasonAveragePoints ?? null,
  };
}

// His NBA team's game today, and its next from today on (today's while it's still to come).
function gamesOf(context: BoardContext, outlook: PlayerOutlook | undefined) {
  const today = context.read.week.todayScoringPeriodId;
  return {
    todaysGame: outlook?.weekGames.find((game) => game.scoringPeriodId === today) ?? null,
    nextGame: outlook?.nextGame ?? null,
  };
}

function headlineFor(outCount: number): string {
  if (outCount === 0) return NO_OUT_STARTER;
  return `You have ${outCount} ${outCount === 1 ? "starter" : "starters"} currently OUT`;
}

// A starter is on the board when ESPN designates him OUT or suspended (D4, D5).
function starterOf(context: BoardContext, slot: LineupSlot, revealAll: boolean): BoardStarter[] {
  const { player } = slot;
  if (player === null) return [];
  const { status } = player.designation;
  if (status !== "OUT" && status !== "SUSPENSION") return [];

  const request = context.requestsByInjured.get(player.playerId) ?? null;
  const options = request === null ? optionsFor(context, player, status) : [];
  const shown = revealAll ? options : options.filter((option) => option.status !== "not_valid");
  return [
    {
      ...describePlayer(context, player),
      ...gamesOf(context, context.outlooks.get(player.playerId)),
      slot: slot.slot,
      designation: status,
      weekToDate: linesOf(context.read, player.playerId).reduce(addLines, NO_LINE),
      forfeitTenths: creditedTenths(context.read, player.playerId),
      startingDays: startingDaysOf(context, player.playerId),
      request: request === null ? null : requestOf(request),
      options: shown,
      hiddenOptionCount: options.length - shown.length,
      optionCounts: countsOf(options),
    },
  ];
}

function startingDaysOf(context: BoardContext, playerId: number): StartingDay[] {
  return context.read.days.flatMap((day) =>
    day.players.flatMap((each) =>
      each.playerId === playerId && each.active && each.line !== null
        ? [
            {
              scoringPeriodId: day.scoringPeriodId,
              date: context.dates.get(day.scoringPeriodId) ?? null,
              points: each.line.fantasyPoints,
            },
          ]
        : []
    )
  );
}

function countsOf(options: readonly BoardOption[]): OptionCounts {
  const count = (status: OptionStatus) => options.filter((each) => each.status === status).length;
  return {
    readyNow: count("ready_now"),
    review: count("review_required"),
    notValid: count("not_valid"),
  };
}

function requestOf(request: SubRequestRecord): BoardRequest {
  const { requestId, status, injuredName, replacementName, filedAt } = request;
  return {
    requestId,
    status,
    injuredName,
    replacementName,
    filedAt,
    amountTenths: requestAmountTenths(request),
  };
}

function optionsFor(
  context: BoardContext,
  injured: LineupPlayer,
  designation: "OUT" | "SUSPENSION"
): BoardOption[] {
  const result = classifyReplacementOptions({
    lineup: context.read.lineup,
    injuredPlayerId: injured.playerId,
  });
  // He is in the starters he was found in.
  if (!result.ok) return [];
  const bench = new Map(
    context.read.lineup.bench.flatMap(({ player }) =>
      player === null ? [] : [[player.playerId, player] as const]
    )
  );
  return result.options
    .map((option) => optionOf(context, injured, option, bench.get(option.playerId)!, designation))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

function optionOf(
  context: BoardContext,
  injured: LineupPlayer,
  option: ReplacementOption,
  player: LineupPlayer,
  designation: "OUT" | "SUSPENSION"
): BoardOption {
  const outlook = context.outlooks.get(player.playerId);
  const edit = planLineupEdit({
    lineup: context.read.lineup,
    injuredPlayerId: injured.playerId,
    replacementPlayerId: option.playerId,
  });
  const { status, reason, takenFor } = statusOf(context, option.playerId, edit, designation);
  return {
    ...describePlayer(context, player),
    status,
    reason,
    takenFor,
    edit: edit === null ? null : namedEdit(context, edit),
    warnings: warningsFor(context.read, player.playerId, outlook),
    gamesLeft: outlook?.gamesLeft ?? 0,
    ...gamesOf(context, outlook),
    upcomingGames: (outlook?.weekGames ?? []).filter(
      (game) => game.scoringPeriodId >= context.read.week.todayScoringPeriodId
    ),
    weekPoints: weekPointsOf(context.read, player.playerId),
    seasonAveragePoints: outlook?.seasonAveragePoints ?? null,
    lineup:
      option.kind === "invalid"
        ? null
        : option.lineup.map(({ slot, playerId }) => ({
            slot,
            playerId,
            name: playerId === null ? null : (context.names.get(playerId) ?? null),
          })),
  };
}

type OptionStanding = {
  status: OptionStatus;
  reason: OptionReason | null;
  takenFor: string | null;
};

// As Confirm routes it (`optionHoldFor`): a direct swap, a one-move rearrangement or an open
// starting slot is Ready now; an edit moving two or more starters, or a suspended starter, goes to
// the commissioner (D5, D9, Dec-D28). A player another request still in flight names, or one no
// lineup fits, is Not valid (Dec-D30); execution re-checks anyway (X7).
function statusOf(
  context: BoardContext,
  playerId: number,
  edit: LineupEdit | null,
  designation: "OUT" | "SUSPENSION"
): OptionStanding {
  const holding = inFlightRequestNaming(context.requests, playerId);
  if (holding !== null) {
    return { status: "not_valid", reason: "taken", takenFor: holding.injuredName };
  }
  if (edit === null) return { status: "not_valid", reason: "no_valid_lineup", takenFor: null };
  const hold = optionHoldFor({ edit, injuredDesignation: designation });
  if (hold === null) return { status: "ready_now", reason: null, takenFor: null };
  const reason = hold === "rearrangement" ? "other_starters_move" : "suspension";
  return { status: "review_required", reason, takenFor: null };
}

function namedEdit(context: BoardContext, edit: LineupEdit): BoardEdit {
  const items = edit.items.map((item) => ({
    ...item,
    name: context.names.get(item.playerId) ?? `player ${item.playerId}`,
  }));
  return { items, movedStarters: edit.movedStarters };
}

// D11: no games left; D12: points this week, which won't count for him from before the request.
function warningsFor(
  read: TeamWeekRead,
  playerId: number,
  outlook: PlayerOutlook | undefined
): OptionWarning[] {
  const warnings: OptionWarning[] = [];
  if ((outlook?.gamesLeft ?? 0) === 0) warnings.push("no_games_left");
  if (linesOf(read, playerId).some((line) => line.fantasyPoints !== 0)) {
    warnings.push("already_scored");
  }
  return warnings;
}

function describePlayer(context: BoardContext, player: LineupPlayer) {
  const outlook = context.outlooks.get(player.playerId);
  return {
    playerId: player.playerId,
    name: player.name,
    proTeam: outlook?.proTeam ?? "",
    position: player.eligibleSlots.filter((slot) => BASE_POSITIONS.includes(slot)).join("/"),
    gameState: todaysGameState(context, outlook),
  };
}

// His NBA team's game today, as the scoreboard read it.
function todaysGameState(context: BoardContext, outlook: PlayerOutlook | undefined) {
  const today = context.read.week.todayScoringPeriodId;
  if (!outlook?.weekGames.some((game) => game.scoringPeriodId === today)) return null;
  return context.gameStates.get(outlook.proTeamId) ?? null;
}

function weekPointsOf(read: TeamWeekRead, playerId: number): number {
  return linesOf(read, playerId).reduce((sum, line) => sum + line.fantasyPoints, 0);
}

// His lines on the matchup's days through today.
function linesOf(read: TeamWeekRead, playerId: number): DayLine[] {
  return read.days.flatMap((day) =>
    day.players.flatMap((each) => (each.playerId === playerId && each.line ? [each.line] : []))
  );
}

function creditedTenths(read: TeamWeekRead, playerId: number): number {
  return read.days
    .flatMap((day) => day.players)
    .filter((each) => each.playerId === playerId && each.active && each.line !== null)
    .reduce((sum, each) => sum + toTenths(each.line!.fantasyPoints), 0);
}

function addLines(sum: DayLine, line: DayLine): DayLine {
  return {
    fantasyPoints: sum.fantasyPoints + line.fantasyPoints,
    points: sum.points + line.points,
    rebounds: sum.rebounds + line.rebounds,
    assists: sum.assists + line.assists,
    steals: sum.steals + line.steals,
    blocks: sum.blocks + line.blocks,
    turnovers: sum.turnovers + line.turnovers,
  };
}
