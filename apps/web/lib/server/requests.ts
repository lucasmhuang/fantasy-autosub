import { randomUUID } from "node:crypto";
import { AppError, loadServerEnv } from "@injurysub/config";
import {
  createRequest,
  type DatabaseExecutor,
  describeFailure,
  findActiveCommissioner,
  findActiveRequest,
  isDatabaseQueryError,
  type LeagueSettings,
  listActiveTeamRequests,
  type NewSubRequest,
  readLeagueSettings,
  type SubRequestRecord,
  violatedUniqueIndex,
} from "@injurysub/db";
import {
  type AdjustmentLine,
  type AdjustmentResult,
  commissionerReasonFor,
  computeAdjustment,
  type DesignationStatus,
  evaluateRequest,
  isMatchupWeekOver,
  isPlayoffPeriod,
  isRequestRefusalReason,
  type RequestEvaluation,
  type RequestRefusalReason,
  type RoutedRequest,
  routeRequest,
  type SubRequestStatus,
  toTenths,
} from "@injurysub/domain";
import { buildCommissionerOutboxEmail } from "@injurysub/email";
import { EspnError, type LineupPlayer, type Matchup, type TeamWeekRead } from "@injurysub/espn";
import {
  type BoardOption,
  type BoardStarter,
  buildTeamBoard,
  type EspnUnavailable,
  readTeamWeek,
} from "./board";
import { getWebDatabaseConnection } from "./db";
import { getWebEspn } from "./espn";
import { getWebLogger } from "./logger";

export type SubmitResult =
  | { status: "invalid_form" | "espn_unreachable" | "no_matchup" | "not_on_team" | "unavailable" }
  | { status: "refused"; reason: RequestRefusalReason; requestId: string }
  | { status: "recorded"; requestId: string; requestStatus: SubRequestStatus };

export type Submitter = { userId: string; role: "manager" | "commissioner"; teamId: number };

type SubmissionIds = { injuredId: number; replacementId: number; idempotencyKey: string };

// One Confirm, as checked against ESPN's state at that moment.
type Submission = {
  user: Submitter;
  now: Date;
  ids: SubmissionIds;
  read: TeamWeekRead;
  matchup: Matchup;
  injured: LineupPlayer;
  replacement: LineupPlayer;
};

type Refused = Extract<RequestEvaluation, { outcome: "refused" }>;
type StoredProjection = { totalTenths: number; lines: AdjustmentLine[] };

// A stored request that breaks what the app wrote into it.
export class StoredRequestError extends AppError {
  override readonly name = "StoredRequestError";
  readonly code = "unreadable_request";
}

const ACTIVE_INJURED_INDEX = "sub_requests_active_injured_unique";
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WAITING: readonly SubRequestStatus[] = ["awaiting_approval", "queued"];

// Confirm: re-checks the request against ESPN now (R4), then records exactly one request, valid
// or refused, with its request-time snapshot (R11, R16, H3, H4) and the commissioner's email when
// they must act (N1). Nothing is recorded without a live check (R20, OQ8), or for players who
// aren't on the team (R18).
export async function submitSubstitutionRequest(input: {
  user: Submitter;
  form: FormData;
  now: Date;
}): Promise<SubmitResult> {
  const ids = parseSubmission(input.form);
  if (ids === null) return { status: "invalid_form" };
  const read = await readTeamWeek(input.user.teamId);
  if ("status" in read) return { status: "espn_unreachable" };
  if (read.matchup === null) return { status: "no_matchup" };
  const injured = rosteredPlayer(read, ids.injuredId);
  const replacement = rosteredPlayer(read, ids.replacementId);
  if (injured === null || replacement === null) return { status: "not_on_team" };

  const submission = { ...input, ids, read, matchup: read.matchup, injured, replacement };
  try {
    return await recordSubmission(submission);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.requests.database_failed", undefined, {
      flow: "submit",
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

function parseSubmission(form: FormData): SubmissionIds | null {
  const injuredId = Number(form.get("injured"));
  const replacementId = Number(form.get("replacement"));
  const idempotencyKey = form.get("idempotencyKey");
  if (!Number.isSafeInteger(injuredId) || !Number.isSafeInteger(replacementId)) return null;
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) return null;
  return { injuredId, replacementId, idempotencyKey };
}

function rosteredPlayer(read: TeamWeekRead, playerId: number): LineupPlayer | null {
  const { starters, bench, injuredReserve } = read.lineup;
  const slot = [...starters, ...bench, ...injuredReserve].find(
    ({ player }) => player?.playerId === playerId
  );
  return slot?.player ?? null;
}

async function recordSubmission(submission: Submission): Promise<SubmitResult> {
  const connection = getWebDatabaseConnection();
  const settings = await readLeagueSettings(connection.db);
  const active = await findActiveRequest(connection.db, activeWhere(submission));
  const evaluation = evaluateRequest(evaluationInputFor(submission, active, settings));
  if (evaluation.outcome === "refused") return recordRefusal(submission, evaluation, settings);

  const routed = routeRequest({
    kind: "substitution",
    teamId: submission.user.teamId,
    optionKind: evaluation.option.kind,
    injuredDesignation: designationOf(submission.injured),
    period: {
      isPlayoffs: isPlayoffPeriod(submission.read.week.matchupPeriodId),
      hasOpponent: submission.matchup.away !== null,
    },
    allowlist: settings.writeAllowlist,
    mode: settings.executionMode,
  });
  try {
    return await recordValid(submission, evaluation, routed, settings);
  } catch (error) {
    // Another Confirm for this starter won the race (AC1-9): record this one's refusal.
    if (violatedUniqueIndex(error) !== ACTIVE_INJURED_INDEX) throw error;
    const winner = await findActiveRequest(connection.db, activeWhere(submission));
    if (winner === null) throw error;
    const refusal = {
      outcome: "refused",
      reason: "active_request_exists",
      activeRequestId: winner.requestId,
    } as const;
    return recordRefusal(submission, refusal, settings);
  }
}

function activeWhere({ read, user, ids }: Submission) {
  return {
    season: read.meta.season,
    matchupPeriodId: read.week.matchupPeriodId,
    teamId: user.teamId,
    injuredPlayerId: ids.injuredId,
  };
}

function evaluationInputFor(
  { read, user, ids, now, injured }: Submission,
  active: SubRequestRecord | null,
  settings: LeagueSettings
) {
  return {
    kind: "substitution" as const,
    requester: { role: user.role, teamId: user.teamId },
    teamId: user.teamId,
    lineup: read.lineup,
    injuredPlayerId: ids.injuredId,
    injuredDesignation: designationOf(injured),
    replacementPlayerId: ids.replacementId,
    replacementDay: {
      tipAt: null,
      currentTenths: todayTenths(read, ids.replacementId),
      final: false,
    },
    week: {
      requestDay: read.week.todayScoringPeriodId,
      lastDay: Math.max(...read.week.scoringPeriodIds),
      concluded: isMatchupWeekOver(read.week),
      lastDayLatestTipAt:
        read.lastDayLatestTipAt === null ? null : new Date(read.lastDayLatestTipAt),
    },
    moment: now,
    activeRequestId: active?.requestId ?? null,
    provingDoneAt: settings.provingDoneAt,
    attestation: null,
  };
}

function designationOf(player: LineupPlayer): DesignationStatus {
  return player.designation.status;
}

function designationText(player: LineupPlayer): string {
  const { designation } = player;
  return designation.status === "unrecognized" ? (designation.raw ?? "none") : designation.status;
}

// His points on ESPN's day so far: his live line, whatever his slot.
function todayTenths(read: TeamWeekRead, playerId: number): number {
  const today = read.days.find((day) => day.scoringPeriodId === read.week.todayScoringPeriodId);
  const line = today?.players.find((player) => player.playerId === playerId)?.line;
  return line ? toTenths(line.fantasyPoints) : 0;
}

// The adjustment if ESPN applied the swap on the request's own day (E = d): the projection until
// ESPN shows the effective day (R2). Chained credits (A20) aren't known at Confirm in 5a.
export function projectAdjustment(
  read: TeamWeekRead,
  injuredId: number,
  replacementId: number
): AdjustmentResult {
  const requestDay = read.week.todayScoringPeriodId;
  return computeAdjustment({
    matchupDays: [...read.week.scoringPeriodIds],
    requestDay,
    effectiveDay: requestDay,
    injured: {
      playerId: injuredId,
      creditedDays: dayPointsOf(read, injuredId, true),
      earlierCredits: [],
    },
    replacement: {
      playerId: replacementId,
      days: dayPointsOf(read, replacementId, false),
      tenthsAtRequest: todayTenths(read, replacementId),
    },
  });
}

function dayPointsOf(read: TeamWeekRead, playerId: number, activeOnly: boolean) {
  return read.days.flatMap((day) => {
    const player = day.players.find((each) => each.playerId === playerId);
    if (!player?.line || (activeOnly && !player.active)) return [];
    return [{ day: day.scoringPeriodId, tenths: toTenths(player.line.fantasyPoints) }];
  });
}

async function recordValid(
  submission: Submission,
  evaluation: Extract<RequestEvaluation, { outcome: "valid" }>,
  routed: RoutedRequest,
  settings: LeagueSettings
): Promise<SubmitResult> {
  const { read, ids } = submission;
  const projection = projectAdjustment(read, ids.injuredId, ids.replacementId);
  const request = requestRowFor(submission, {
    status: routed.status,
    reviewReason: routed.reviewReason,
    refusalReason: null,
    executionModeAtRequest: settings.executionMode,
    replacementPointsAtRequestTenths: evaluation.pointsAtRequest.tenths,
    snapshotSource: evaluation.pointsAtRequest.source,
    projectedAdjustmentTenths: projection.ok ? projection.totalTenths : null,
    expiresAt: WAITING.includes(routed.status) ? expiryFrom(submission.now) : null,
  });
  const recorded = await getWebDatabaseConnection().transaction(async (tx) => {
    const email = await commissionerEmailFor(tx, submission, request);
    return createRequest(tx, {
      request,
      snapshot: snapshotOf(submission, projection.ok ? projection : null),
      event: eventOf(submission, "request_filed", {
        status: routed.status,
        reviewReason: routed.reviewReason,
      }),
      email,
    });
  });
  return resultOf(recorded.request);
}

async function recordRefusal(
  submission: Submission,
  refusal: Refused,
  settings: LeagueSettings
): Promise<SubmitResult> {
  const request = requestRowFor(submission, {
    status: "refused",
    reviewReason: null,
    refusalReason: refusal.reason,
    executionModeAtRequest: settings.executionMode,
    replacementPointsAtRequestTenths: todayTenths(submission.read, submission.ids.replacementId),
    snapshotSource: "observed",
    projectedAdjustmentTenths: null,
    expiresAt: null,
  });
  const recorded = await getWebDatabaseConnection().transaction((tx) =>
    createRequest(tx, {
      request,
      snapshot: snapshotOf(submission, null),
      event: eventOf(submission, "request_refused", { refusal }),
      email: null,
    })
  );
  return resultOf(recorded.request);
}

type RequestFields = Pick<
  NewSubRequest,
  | "status"
  | "reviewReason"
  | "refusalReason"
  | "executionModeAtRequest"
  | "replacementPointsAtRequestTenths"
  | "snapshotSource"
  | "projectedAdjustmentTenths"
  | "expiresAt"
>;

function requestRowFor(submission: Submission, fields: RequestFields): NewSubRequest {
  const { read, user, ids, now, matchup, injured, replacement } = submission;
  const injuredSlot = read.lineup.starters.find(({ player }) => player?.playerId === ids.injuredId);
  return {
    requestId: randomUUID(),
    kind: "substitution",
    teamId: user.teamId,
    season: read.meta.season,
    matchupPeriodId: read.week.matchupPeriodId,
    matchupId: matchup.matchupId,
    requestedBy: user.userId,
    idempotencyKey: ids.idempotencyKey,
    injuredPlayerId: ids.injuredId,
    injuredName: injured.name,
    // A starter no longer starting is refused; his slot is then where ESPN has him now.
    injuredSlot: injuredSlot?.slot ?? "BE",
    replacementPlayerId: ids.replacementId,
    replacementName: replacement.name,
    requestMoment: now,
    filedAt: now,
    requestDay: read.week.todayScoringPeriodId,
    designationAtRequest: designationText(injured),
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + loadServerEnv().REQUEST_EXPIRY_HOURS * 3_600_000);
}

// What ESPN showed at the request moment, kept unchanged (H4), with the projected adjustment's
// lines (its breakdown, H1, Q4).
function snapshotOf({ read, now }: Submission, projection: StoredProjection | null) {
  return {
    snapshotId: randomUUID(),
    espnDay: read.week.todayScoringPeriodId,
    takenAt: now,
    payload: {
      meta: read.meta,
      lineup: read.lineup,
      matchup: read.matchup,
      days: read.days,
      projection:
        projection === null
          ? null
          : { totalTenths: projection.totalTenths, lines: projection.lines },
    },
  };
}

function eventOf(
  { user, now }: Submission,
  eventType: "request_filed" | "request_refused",
  payload: Record<string, unknown>
) {
  return {
    eventId: randomUUID(),
    actorType: "manager" as const,
    actorUserId: user.userId,
    eventType,
    payload,
    createdAt: now,
  };
}

async function commissionerEmailFor(
  tx: DatabaseExecutor,
  submission: Submission,
  request: NewSubRequest
) {
  // Null for a request that doesn't need the commissioner (a queued one).
  const reason = commissionerReasonFor(request.status, request.reviewReason ?? null);
  if (reason === null) return null;
  const commissioner = await findActiveCommissioner(tx);
  if (commissioner === null) {
    getWebLogger().warn("web.requests.no_commissioner", { requestId: request.requestId });
    return null;
  }
  const email = buildCommissionerOutboxEmail({
    requestId: request.requestId,
    version: 0,
    to: commissioner.email,
    teamName: submission.read.lineup.teamName,
    teamId: request.teamId,
    injuredName: request.injuredName,
    replacementName: request.replacementName,
    reason,
    adjustmentTenths: request.projectedAdjustmentTenths ?? null,
  });
  return { emailId: randomUUID(), ...email, createdAt: submission.now };
}

// A repeated Confirm gives back what the first one recorded, refused or not (R11).
function resultOf(request: SubRequestRecord): SubmitResult {
  if (request.status === "refused") {
    const stored = request.refusalReason ?? "";
    if (!isRequestRefusalReason(stored)) {
      throw new StoredRequestError("A refused request's stored reason isn't a known one.");
    }
    return { status: "refused", reason: stored, requestId: request.requestId };
  }
  return { status: "recorded", requestId: request.requestId, requestStatus: request.status };
}

export type ProjectionLine = {
  day: number;
  name: string;
  tenths: number;
  why: AdjustmentLine["why"];
};

export type ConfirmationView =
  | { status: EspnUnavailable["status"] | "season_over" | "not_offered" }
  | { status: "already_requested"; requestId: string }
  | {
      status: "confirm";
      teamName: string;
      starter: BoardStarter;
      option: BoardOption;
      projection: { totalTenths: number; lines: ProjectionLine[] } | null;
      // Whether ESPN's league rules differ from InjurySub's, so the adjustment would be held
      // (OQ11); null when the check couldn't be read.
      rulesHeld: boolean | null;
      idempotencyKey: string;
    };

type ConfirmationAsk = { teamId: number; injuredId: number; replacementId: number };

// The summary before Confirm (R1, R2): who goes out and comes in, the projected adjustment day by
// day, warnings, whether the adjustment would be held (OQ11), and a fresh idempotency key. The
// page reads ESPN again at Confirm (R4); leaving it records nothing (R3).
export async function loadConfirmation(input: ConfirmationAsk): Promise<ConfirmationView> {
  const read = await readTeamWeek(input.teamId);
  if ("status" in read) return read;
  if (isMatchupWeekOver(read.week)) return { status: "season_over" };
  try {
    const requests = await listActiveTeamRequests(getWebDatabaseConnection().db, {
      season: read.meta.season,
      matchupPeriodId: read.week.matchupPeriodId,
      teamId: input.teamId,
    });
    return await confirmationFrom(read, requests, input);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.requests.database_failed", undefined, {
      flow: "confirmation",
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

async function confirmationFrom(
  read: TeamWeekRead,
  requests: SubRequestRecord[],
  ask: ConfirmationAsk
): Promise<ConfirmationView> {
  const board = buildTeamBoard(read, requests, true);
  if (board.status !== "board") return { status: board.status };
  const starter = [...board.outStarters, ...board.suspendedStarters].find(
    (each) => each.playerId === ask.injuredId
  );
  if (starter === undefined) return { status: "not_offered" };
  if (starter.request !== null) {
    return { status: "already_requested", requestId: starter.request.requestId };
  }
  const option = starter.options.find(
    (each) => each.playerId === ask.replacementId && each.status !== "not_valid"
  );
  if (option === undefined) return { status: "not_offered" };
  return {
    status: "confirm",
    teamName: board.teamName,
    starter,
    option,
    projection: projectionView(read, ask),
    rulesHeld: await rulesDiffer(),
    idempotencyKey: randomUUID(),
  };
}

function projectionView(read: TeamWeekRead, ask: ConfirmationAsk) {
  const result = projectAdjustment(read, ask.injuredId, ask.replacementId);
  if (!result.ok) return null;
  const lines = result.lines.map(({ day, playerId, tenths, why }) => ({
    day,
    name: rosteredPlayer(read, playerId)?.name ?? `player ${playerId}`,
    tenths,
    why,
  }));
  return { totalTenths: result.totalTenths, lines };
}

async function rulesDiffer(): Promise<boolean | null> {
  try {
    return (await getWebEspn().checkLeagueRules()).mismatches.length > 0;
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.requests.rules_unread", { code: error.code });
    return null;
  }
}
