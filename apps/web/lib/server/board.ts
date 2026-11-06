import {
  describeFailure,
  isDatabaseQueryError,
  listActiveTeamRequests,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  classifyReplacementOptions,
  isMatchupWeekOver,
  type ReplacementOption,
  type SubRequestStatus,
  toTenths,
} from "@injurysub/domain";
import {
  type DayLine,
  EspnError,
  type EspnErrorCode,
  type LineupPlayer,
  type LineupSlot,
  type PlayerOutlook,
  type ProGame,
  type TeamWeekRead,
} from "@injurysub/espn";
import { getWebDatabaseConnection } from "./db";
import { getWebEspn } from "./espn";
import { getWebLogger } from "./logger";

export type OptionStatus = "ready_now" | "review_required" | "not_valid";
export type OptionReason = "other_starters_move" | "suspension" | "no_valid_lineup" | "taken";
export type OptionWarning = "no_games_left" | "already_scored";

export type BoardLineupSlot = { slot: string; playerId: number | null; name: string | null };

export type BoardOption = {
  playerId: number;
  name: string;
  proTeam: string;
  position: string;
  status: OptionStatus;
  reason: OptionReason | null;
  warnings: OptionWarning[];
  gamesLeft: number;
  nextGame: ProGame | null;
  seasonAveragePoints: number | null;
  lineup: BoardLineupSlot[] | null;
};

export type BoardRequest = {
  requestId: string;
  status: SubRequestStatus;
  replacementName: string;
};

export type BoardStarter = {
  playerId: number;
  name: string;
  proTeam: string;
  position: string;
  slot: string;
  designation: "OUT" | "SUSPENSION";
  // His lines this matchup week, today's live one included, whatever his slot.
  weekToDate: DayLine;
  // What a substitution would cost him: his points in active slots this week, today's included
  // (behaviors D1, OQ26).
  forfeitTenths: number;
  request: BoardRequest | null;
  options: BoardOption[];
  hiddenOptionCount: number;
};

export type TeamBoard =
  | { status: "not_connected" | "unavailable" | "credentials_rejected" | "season_over" }
  | {
      status: "board";
      teamName: string;
      readAt: string;
      headline: string;
      outStarters: BoardStarter[];
      suspendedStarters: BoardStarter[];
    };

const NO_OUT_STARTER =
  "None of your starters are currently listed as OUT. If this just changed, give ESPN a few minutes to update and refresh.";
const BASE_POSITIONS = ["PG", "SG", "SF", "PF", "C"];
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
  taken: ReadonlySet<number>;
};

// A team's board as of ESPN's state now (OQ5: the read time is shown; Confirm re-checks): each
// OUT starter with his week and his options, suspended starters apart (OQ19), and the starter's
// request instead of options while one holds him (D14).
export async function loadTeamBoard(input: {
  teamId: number;
  revealAll: boolean;
}): Promise<TeamBoard> {
  const read = await readTeamWeek(input.teamId);
  if ("status" in read) return read;
  if (isMatchupWeekOver(read.week)) return { status: "season_over" };

  try {
    const requests = await listActiveTeamRequests(getWebDatabaseConnection().db, {
      season: read.meta.season,
      matchupPeriodId: read.week.matchupPeriodId,
      teamId: input.teamId,
    });
    return buildTeamBoard(read, requests, input.revealAll);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.board.database_failed", undefined, {
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

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

// The board for a read and the team's live requests this matchup.
export function buildTeamBoard(
  read: TeamWeekRead,
  requests: SubRequestRecord[],
  revealAll: boolean
): TeamBoard {
  return boardFrom(contextOf(read, requests), revealAll);
}

function espnFailureStatus(code: EspnErrorCode): EspnUnavailable["status"] {
  if (code === "not_connected" || code === "credentials_rejected") return code;
  return "unavailable";
}

function contextOf(read: TeamWeekRead, requests: SubRequestRecord[]): BoardContext {
  const { starters, bench, injuredReserve } = read.lineup;
  const rostered = [...starters, ...bench, ...injuredReserve].flatMap(({ player }) =>
    player === null ? [] : [player]
  );
  return {
    read,
    outlooks: new Map(read.players.map((outlook) => [outlook.playerId, outlook])),
    names: new Map(rostered.map((player) => [player.playerId, player.name])),
    requestsByInjured: new Map(requests.map((request) => [request.injuredPlayerId, request])),
    // OQ10: a bench player a live request names is taken; execution re-checks anyway (X7).
    taken: new Set(requests.map((request) => request.replacementPlayerId)),
  };
}

function boardFrom(context: BoardContext, revealAll: boolean): TeamBoard {
  const starters = context.read.lineup.starters.flatMap((slot) =>
    starterOf(context, slot, revealAll)
  );
  const outStarters = starters.filter((each) => each.designation === "OUT");
  return {
    status: "board",
    teamName: context.read.lineup.teamName,
    readAt: context.read.meta.readAt,
    headline: headlineFor(outStarters.length),
    outStarters,
    suspendedStarters: starters.filter((each) => each.designation === "SUSPENSION"),
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
      slot: slot.slot,
      designation: status,
      weekToDate: linesOf(context.read, player.playerId).reduce(addLines, NO_LINE),
      forfeitTenths: creditedTenths(context.read, player.playerId),
      request: request === null ? null : requestOf(request),
      options: shown,
      hiddenOptionCount: options.length - shown.length,
    },
  ];
}

function requestOf(request: SubRequestRecord): BoardRequest {
  const { requestId, status, replacementName } = request;
  return { requestId, status, replacementName };
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
    .map((option) => optionOf(context, option, bench.get(option.playerId)!, designation))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

function optionOf(
  context: BoardContext,
  option: ReplacementOption,
  player: LineupPlayer,
  designation: "OUT" | "SUSPENSION"
): BoardOption {
  const outlook = context.outlooks.get(player.playerId);
  const { status, reason } = statusOf(context, option, designation);
  return {
    ...describePlayer(context, player),
    status,
    reason,
    warnings: warningsFor(context.read, player.playerId, outlook),
    gamesLeft: outlook?.gamesLeft ?? 0,
    nextGame: outlook?.nextGame ?? null,
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

// In this step only a direct swap is automated (Ready now); a rearrangement or a suspended
// starter goes to the commissioner (D5, D9); a taken player or one no lineup fits is Not valid.
function statusOf(
  context: BoardContext,
  option: ReplacementOption,
  designation: "OUT" | "SUSPENSION"
): { status: OptionStatus; reason: OptionReason | null } {
  if (context.taken.has(option.playerId)) return { status: "not_valid", reason: "taken" };
  if (option.kind === "invalid") return { status: "not_valid", reason: "no_valid_lineup" };
  if (designation === "SUSPENSION") return { status: "review_required", reason: "suspension" };
  if (option.kind === "rearrangement") {
    return { status: "review_required", reason: "other_starters_move" };
  }
  return { status: "ready_now", reason: null };
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
  return {
    playerId: player.playerId,
    name: player.name,
    proTeam: context.outlooks.get(player.playerId)?.proTeam ?? "",
    position: player.eligibleSlots.filter((slot) => BASE_POSITIONS.includes(slot)).join("/"),
  };
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
