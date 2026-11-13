import { randomUUID } from "node:crypto";
import { AppError, loadServerEnv } from "@injurysub/config";
import {
  appendEvent,
  createRequest,
  type DatabaseExecutor,
  describeFailure,
  findActiveCommissioner,
  findActiveRequest,
  getRequestDetail,
  isDatabaseQueryError,
  type LeagueSettings,
  listActiveTeamRequests,
  type NewSubRequest,
  readLeagueSettings,
  type SubRequestRecord,
  transitionRequest,
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
  transition,
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

export type SubmissionIds = { injuredId: number; replacementId: number; idempotencyKey: string };

// What the commissioner attests for an on-behalf request, at its stated moment (Q16).
export type Attestation = {
  designation: "OUT" | "SUSPENSION";
  replacementGame: "not_started" | "ended" | "in_progress";
  enteredTenths: number | null;
  note: string | null;
};

// Whose request it is and when: a manager's Confirm now, or the commissioner filing on a team's
// behalf at a stated moment, which may be on an earlier ESPN day.
export type Filing = {
  kind: "substitution" | "on_behalf";
  teamId: number;
  moment: Date;
  requestDay: number;
  attestation: Attestation | null;
};

// One request as it's filed, checked against ESPN's state now; `now` is when it's filed.
export type Submission = {
  user: { userId: string; role: "manager" | "commissioner"; teamId: number | null };
  now: Date;
  ids: SubmissionIds;
  read: TeamWeekRead;
  matchup: Matchup;
  injured: LineupPlayer;
  replacement: LineupPlayer;
  filing: Filing;
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

  const filing: Filing = {
    kind: "substitution",
    teamId: input.user.teamId,
    moment: input.now,
    requestDay: read.week.todayScoringPeriodId,
    attestation: null,
  };
  const { matchup } = read;
  return recordFiling({ ...input, ids, read, matchup, injured, replacement, filing }, "submit");
}

// Records one filing, or answers "try again" when the database fails.
export async function recordFiling(submission: Submission, flow: string): Promise<SubmitResult> {
  try {
    return await recordSubmission(submission);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.requests.database_failed", undefined, {
      flow,
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

export function parseSubmission(form: FormData): SubmissionIds | null {
  const injuredId = Number(form.get("injured"));
  const replacementId = Number(form.get("replacement"));
  const idempotencyKey = form.get("idempotencyKey");
  if (!Number.isSafeInteger(injuredId) || !Number.isSafeInteger(replacementId)) return null;
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) return null;
  return { injuredId, replacementId, idempotencyKey };
}

export function rosteredPlayer(read: TeamWeekRead, playerId: number): LineupPlayer | null {
  const { starters, bench, injuredReserve } = read.lineup;
  const slot = [...starters, ...bench, ...injuredReserve].find(
    ({ player }) => player?.playerId === playerId
  );
  return slot?.player ?? null;
}

async function recordSubmission(submission: Submission): Promise<SubmitResult> {
  const connection = getWebDatabaseConnection();
  const settings = await readLeagueSettings(connection.db);
  const existing = await existingRequestsFor(connection.db, submission);
  const evaluation = evaluateRequest(evaluationInputFor(submission, existing, settings));
  if (evaluation.outcome === "refused") return recordRefusal(submission, evaluation, settings);

  const routed = routeRequest({
    kind: submission.filing.kind,
    teamId: submission.filing.teamId,
    edit: evaluation.edit,
    injuredDesignation: designationFor(submission),
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

type ExistingRequests = { active: SubRequestRecord | null; teamRequests: SubRequestRecord[] };

// The injured player's request this matchup, if any, and every live request of the team's.
async function existingRequestsFor(
  db: DatabaseExecutor,
  submission: Submission
): Promise<ExistingRequests> {
  const where = activeWhere(submission);
  const { season, matchupPeriodId, teamId } = where;
  return {
    active: await findActiveRequest(db, where),
    teamRequests: await listActiveTeamRequests(db, { season, matchupPeriodId, teamId }),
  };
}

function activeWhere({ read, filing, ids }: Submission) {
  return {
    season: read.meta.season,
    matchupPeriodId: read.week.matchupPeriodId,
    teamId: filing.teamId,
    injuredPlayerId: ids.injuredId,
  };
}

function evaluationInputFor(
  submission: Submission,
  existing: ExistingRequests,
  settings: LeagueSettings
) {
  const { read, user, ids, filing } = submission;
  const { attestation } = filing;
  return {
    kind: filing.kind,
    requester: { role: user.role, teamId: user.teamId },
    teamId: filing.teamId,
    lineup: read.lineup,
    injuredPlayerId: ids.injuredId,
    injuredDesignation: designationFor(submission),
    replacementPlayerId: ids.replacementId,
    replacementDay: {
      tipAt: tipOn(read, ids.replacementId, filing.requestDay),
      currentTenths: dayTenths(read, ids.replacementId, filing.requestDay),
      // A complete day's line is final; today's is still changing.
      final: filing.requestDay < read.week.todayScoringPeriodId,
    },
    week: weekFor(read, filing.requestDay),
    moment: filing.moment,
    activeRequestId: existing.active?.requestId ?? null,
    teamRequests: existing.teamRequests,
    provingDoneAt: settings.provingDoneAt,
    attestation:
      attestation === null
        ? null
        : {
            replacementGame: attestation.replacementGame,
            enteredTenths: attestation.enteredTenths,
          },
  };
}

function weekFor(read: TeamWeekRead, requestDay: number) {
  return {
    requestDay,
    lastDay: Math.max(...read.week.scoringPeriodIds),
    concluded: isMatchupWeekOver(read.week),
    lastDayLatestTipAt: read.lastDayLatestTipAt === null ? null : new Date(read.lastDayLatestTipAt),
  };
}

// The designation the request is judged on: ESPN's now, or the one the commissioner attests for
// an on-behalf request's stated moment (Dec-D22).
function designationFor({ injured, filing }: Submission): DesignationStatus {
  return filing.attestation?.designation ?? injured.designation.status;
}

// When his NBA team's game on that ESPN day tipped, or null for no game.
function tipOn(read: TeamWeekRead, playerId: number, day: number): Date | null {
  const outlook = read.players.find((player) => player.playerId === playerId);
  const game = outlook?.weekGames.find((each) => each.scoringPeriodId === day);
  return game === undefined ? null : new Date(game.date);
}

function designationText(player: LineupPlayer): string {
  const { designation } = player;
  return designation.status === "unrecognized" ? (designation.raw ?? "none") : designation.status;
}

// His points on an ESPN day, whatever his slot: today's so far, or a complete day's final line.
function dayTenths(read: TeamWeekRead, playerId: number, day: number): number {
  const lines = read.days.find((each) => each.scoringPeriodId === day);
  const line = lines?.players.find((player) => player.playerId === playerId)?.line;
  return line ? toTenths(line.fantasyPoints) : 0;
}

// The adjustment if ESPN applied the swap on the request's own day (E = d): the projection until
// ESPN shows the effective day (R2). Chained credits (A20) aren't known at Confirm in 5a.
export function projectAdjustment(
  read: TeamWeekRead,
  injuredId: number,
  replacementId: number,
  at: { requestDay: number; tenthsAtRequest: number } = {
    requestDay: read.week.todayScoringPeriodId,
    tenthsAtRequest: dayTenths(read, replacementId, read.week.todayScoringPeriodId),
  }
): AdjustmentResult {
  const { requestDay, tenthsAtRequest } = at;
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
      tenthsAtRequest,
    },
  });
}

export function dayPointsOf(read: TeamWeekRead, playerId: number, activeOnly: boolean) {
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
  const { read, ids, filing } = submission;
  const projection = projectAdjustment(read, ids.injuredId, ids.replacementId, {
    requestDay: filing.requestDay,
    tenthsAtRequest: evaluation.pointsAtRequest.tenths,
  });
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
        attestation: filing.attestation,
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
    replacementPointsAtRequestTenths: dayTenths(
      submission.read,
      submission.ids.replacementId,
      submission.filing.requestDay
    ),
    snapshotSource: "observed",
    projectedAdjustmentTenths: null,
    expiresAt: null,
  });
  const recorded = await getWebDatabaseConnection().transaction((tx) =>
    createRequest(tx, {
      request,
      snapshot: snapshotOf(submission, null),
      event: eventOf(submission, "request_refused", {
        refusal,
        attestation: submission.filing.attestation,
      }),
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
  const { read, user, ids, now, matchup, injured, replacement, filing } = submission;
  const injuredSlot = read.lineup.starters.find(({ player }) => player?.playerId === ids.injuredId);
  const { attestation } = filing;
  return {
    requestId: randomUUID(),
    kind: filing.kind,
    teamId: filing.teamId,
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
    requestMoment: filing.moment,
    filedAt: now,
    requestDay: filing.requestDay,
    designationAtRequest: attestation?.designation ?? designationText(injured),
    designationAtFiling: attestation === null ? null : designationText(injured),
    attestedFields: attestation === null ? [] : attestedFieldsOf(attestation),
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

// What the commissioner attested rather than ESPN showed (Q16).
function attestedFieldsOf(attestation: Attestation): string[] {
  const fields = ["designation", "replacement_game"];
  return attestation.enteredTenths === null ? fields : [...fields, "points_at_request"];
}

// From filing, never from an on-behalf request's stated moment (AC1-2).
function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + loadServerEnv().REQUEST_EXPIRY_HOURS * 3_600_000);
}

// What ESPN showed at the request moment, kept unchanged (H4), with the projected adjustment's
// lines (its breakdown, H1, Q4).
// An on-behalf request's snapshot is what ESPN showed at filing, labelled so (Q16).
function snapshotOf({ read, now, filing }: Submission, projection: StoredProjection | null) {
  return {
    snapshotId: randomUUID(),
    espnDay: read.week.todayScoringPeriodId,
    takenAt: now,
    payload: {
      taken: filing.kind === "on_behalf" ? "at_filing" : "at_request",
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
  { user, now, filing }: Submission,
  eventType: "request_filed" | "request_refused",
  payload: Record<string, unknown>
) {
  return {
    eventId: randomUUID(),
    actorType: filing.kind === "on_behalf" ? ("commissioner" as const) : ("manager" as const),
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
  // Null for a request that doesn't need the commissioner (a queued one), or one they filed.
  const reason = commissionerReasonFor(request.status, request.reviewReason ?? null);
  if (reason === null || submission.filing.kind === "on_behalf") return null;
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

export type WithdrawResult = {
  status: "withdrawn" | "not_found" | "cannot_withdraw" | "changed" | "unavailable";
};

// A manager withdraws their team's request while nothing was sent to ESPN for it (OQ6), which
// frees its starter for a new request (R15). Under the request's version: of two actions at once,
// only the first takes effect.
export async function withdrawRequest(input: {
  user: Submitter;
  requestId: string;
  now: Date;
}): Promise<WithdrawResult> {
  if (!IDEMPOTENCY_KEY.test(input.requestId)) return { status: "not_found" };
  try {
    return await getWebDatabaseConnection().transaction((tx) => withdrawIn(tx, input));
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.requests.database_failed", undefined, {
      flow: "withdraw",
      reason: describeFailure(error),
    });
    return { status: "unavailable" };
  }
}

async function withdrawIn(
  tx: DatabaseExecutor,
  { user, requestId, now }: { user: Submitter; requestId: string; now: Date }
): Promise<WithdrawResult> {
  const detail = await getRequestDetail(tx, requestId);
  if (detail === null || detail.request.teamId !== user.teamId) return { status: "not_found" };
  const { request } = detail;
  const result = transition(
    request,
    { type: "withdraw" },
    { matchupEnded: false, writeGate: "open" }
  );
  if (!result.ok) return { status: "cannot_withdraw" };
  const moved = await transitionRequest(tx, {
    requestId,
    fromStatus: request.status,
    version: request.version,
    patch: { status: result.status, reviewReason: result.reviewReason },
    now,
  });
  if (moved === null) return { status: "changed" };
  await appendEvent(tx, requestId, {
    eventId: randomUUID(),
    actorType: "manager",
    actorUserId: user.userId,
    eventType: "withdrawn",
    payload: { from: request.status },
    createdAt: now,
  });
  return { status: "withdrawn" };
}
