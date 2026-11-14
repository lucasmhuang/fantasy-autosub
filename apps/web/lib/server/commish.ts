import {
  describeFailure,
  getEspnAccess,
  getRequestDetail,
  isDatabaseQueryError,
  listCommissionerQueue,
  type RequestDetail,
  readLeagueSettings,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  ADJUSTMENT_REASON_MAX_LENGTH,
  adjustmentReasonEntry,
  allowedActions,
  buildManualInstructions,
  commissionerReasonFor,
  confirmedPlanOf,
  type EspnAccessState,
  espnBlockFor,
  hasMatchupEnded,
  isSameEdit,
  type LineupMove,
  planLineupEdit,
  type RequestActionType,
  type RequestSnapshotPhase,
  type SubRequestStatus,
  toTenths,
  type WriteGate,
  writeGateFor,
} from "@injurysub/domain";
import { EspnError, type MatchupSide, type RuleMismatch, type TeamWeekRead } from "@injurysub/espn";
import { z } from "zod";
import { type EspnUnavailable, readTeamWeek } from "./board";
import type { CommissionerAction } from "./commish-actions";
import { amountToApprove, heldAmountOf } from "./commish-approval";
import { getWebDatabaseConnection } from "./db";
import { getWebEspn } from "./espn";
import { getWebLogger } from "./logger";
import { type BreakdownLine, breakdownOf, REQUEST_ID } from "./request-view";
import type { Attestation } from "./requests";

export type QueueEntry = {
  requestId: string;
  teamId: number;
  injuredName: string;
  replacementName: string;
  status: SubRequestStatus;
  needsAction: boolean;
  why: string | null;
  // Held up by ESPN access while it waits to run (O4): the state ESPN is in.
  blocked: "credentials_rejected" | "unreachable" | null;
  adjustmentTenths: number | null;
  filedAt: Date;
};

export type CommissionerQueue =
  | { status: "unavailable" }
  | { status: "found"; requests: QueueEntry[] };

// ESPN's access as the commissioner's page shows it (O1), from a live rules check.
export type EspnStatus = {
  state: "working" | "rules_mismatch" | "credentials_rejected" | "unreachable" | "not_connected";
  mismatches: readonly RuleMismatch[];
  checkedAt: string;
};

export type ManualSteps =
  | { status: "not_needed" }
  | { status: "unavailable"; reason: "espn_unreachable" | "lineup_changed" | "week_moved_on" }
  | {
      status: "ready";
      lineupMoves: NamedMove[];
      // The edit confirmed, when it differs from the one the lineup now gives (Dec-D29b).
      confirmedMoves: NamedMove[] | null;
      // Where ESPN's Scoreboard shows it: the matchup period's number and the team's name now.
      adjustment: {
        matchupPeriodId: number;
        teamName: string;
        currentTenths: number;
        enterTenths: number;
        reason: string | null;
        reasonTooLong: boolean;
      } | null;
    };

type NamedMove = { name: string; fromSlot: string; toSlot: string };

export type RequestDetailView =
  | { status: "not_found" | "unavailable" | "proving" }
  | {
      status: "found";
      request: SubRequestRecord;
      why: string | null;
      blocked: "credentials_rejected" | "unreachable" | null;
      // What the commissioner may do with it now.
      actions: CommissionerAction[];
      // The approval on offer, with the amount it would approve; null when none is.
      approval: ApprovalOffer | null;
      breakdown: BreakdownLine[];
      events: { eventType: string; actorType: string; createdAt: Date; payload: unknown }[];
      snapshots: { phase: RequestSnapshotPhase; espnDay: number; takenAt: Date }[];
      instructions: ManualSteps;
      adjustment: AdjustmentFigures;
      filing: OnBehalfFiling | null;
    };

export type ApprovalOffer = {
  action: "approve" | "reapprove";
  computedTenths: number;
  overrideTenths: number | null;
};

// Q8: the computed amount, any override beside it, and the amount applied once it's done.
export type AdjustmentFigures = {
  computedTenths: number | null;
  overrideTenths: number | null;
  appliedTenths: number | null;
};

// Q16, H2: what the commissioner attested for a request filed on a team's behalf, with ESPN's
// designation at filing beside the one attested.
export type OnBehalfFiling = {
  statedMoment: Date;
  filedAt: Date;
  designation: string;
  designationAtFiling: string | null;
  replacementGame: Attestation["replacementGame"] | null;
  enteredTenths: number | null;
  note: string | null;
  attestedFields: string[];
};

const NEEDS_THE_COMMISSIONER: readonly SubRequestStatus[] = ["awaiting_approval", "needs_review"];
const completionSchema = z.object({ computedTenths: z.number().int().nullable() });
const filedSchema = z.object({
  attestation: z.object({
    replacementGame: z.enum(["not_started", "ended", "in_progress"]),
    enteredTenths: z.number().int().nullable(),
    note: z.string().nullable(),
  }),
});

// Every team's requests, those needing the commissioner first (Q3).
export async function loadCommissionerQueue(): Promise<CommissionerQueue> {
  try {
    const { db } = getWebDatabaseConnection();
    const rows = await listCommissionerQueue(db);
    const access = (await getEspnAccess(db))?.state ?? null;
    return { status: "found", requests: rows.map((row) => queueEntryOf(row, access)) };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "queue");
    return { status: "unavailable" };
  }
}

function queueEntryOf(row: SubRequestRecord, access: EspnAccessState | null): QueueEntry {
  return {
    requestId: row.requestId,
    teamId: row.teamId,
    injuredName: row.injuredName,
    replacementName: row.replacementName,
    status: row.status,
    needsAction: NEEDS_THE_COMMISSIONER.includes(row.status),
    why: commissionerReasonFor(row.status, row.reviewReason),
    blocked: espnBlockFor(row.status, access),
    adjustmentTenths: adjustmentOf(row),
    filedAt: row.filedAt,
  };
}

function adjustmentOf(row: SubRequestRecord): number | null {
  return row.finalAdjustmentTenths ?? row.overrideAdjustmentTenths ?? row.projectedAdjustmentTenths;
}

// One request's whole record (H2), why it needs the commissioner, and what's left to do by hand
// on ESPN (Q4, Q5).
export async function loadRequestDetail(input: { requestId: string }): Promise<RequestDetailView> {
  if (!REQUEST_ID.test(input.requestId)) return { status: "not_found" };
  const stored = await readStored(input.requestId);
  if (stored === "unavailable") return { status: "unavailable" };
  const { detail, access, allowlist } = stored;
  if (detail === null) return { status: "not_found" };
  // A test run on team 1 has its own page (S20).
  if (detail.request.kind === "proving") return { status: "proving" };
  const { request, snapshots, events } = detail;
  // Read live, once, for what's left by hand and for what can be approved.
  const read = NEEDS_THE_COMMISSIONER.includes(request.status)
    ? await readTeamWeek(request.teamId)
    : null;
  const week = read === null || "status" in read ? null : read;
  const gate = writeGateFor(allowlist, request.teamId);
  const approval = approvalOffer(allowedNow(request, gate, week), request, events, week);
  return {
    status: "found",
    request,
    why: commissionerReasonFor(request.status, request.reviewReason),
    blocked: espnBlockFor(request.status, access),
    actions: commissionerActionsFor(request, gate, week, approval),
    approval,
    breakdown: breakdownOf(request, snapshots),
    events: events.map(({ eventType, actorType, createdAt, payload }) => ({
      eventType,
      actorType,
      createdAt,
      payload,
    })),
    snapshots: snapshots.map(({ phase, espnDay, takenAt }) => ({ phase, espnDay, takenAt })),
    instructions: manualStepsFor(request, snapshots, read),
    adjustment: adjustmentFiguresOf(request, events),
    filing: filingOf(request, events),
  };
}

// The request's record, ESPN's access state and the teams automation covers, from the database.
async function readStored(requestId: string) {
  try {
    const { db } = getWebDatabaseConnection();
    const detail = await getRequestDetail(db, requestId);
    const access = (await getEspnAccess(db))?.state ?? null;
    const allowlist = (await readLeagueSettings(db)).writeAllowlist;
    return { detail, access, allowlist };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "request_detail");
    return "unavailable" as const;
  }
}

// Once completed by hand, the computed amount is the one worked out for the effective day.
function adjustmentFiguresOf(
  request: SubRequestRecord,
  events: RequestDetail["events"]
): AdjustmentFigures {
  const completion = completionSchema.safeParse(
    events.findLast((event) => event.eventType === "completed_manually")?.payload
  );
  return {
    computedTenths: completion.success
      ? completion.data.computedTenths
      : request.projectedAdjustmentTenths,
    overrideTenths: request.overrideAdjustmentTenths,
    appliedTenths: request.finalAdjustmentTenths,
  };
}

function filingOf(
  request: SubRequestRecord,
  events: RequestDetail["events"]
): OnBehalfFiling | null {
  if (request.kind !== "on_behalf") return null;
  const filed = filedSchema.safeParse(
    events.find((event) => event.eventType === "request_filed")?.payload
  );
  const attestation = filed.success ? filed.data.attestation : null;
  return {
    statedMoment: request.requestMoment,
    filedAt: request.filedAt,
    designation: request.designationAtRequest,
    designationAtFiling: request.designationAtFiling,
    replacementGame: attestation?.replacementGame ?? null,
    enteredTenths: attestation?.enteredTenths ?? null,
    note: attestation?.note ?? null,
    attestedFields: request.attestedFields,
  };
}

const COMMISSIONER_ACTIONS: { domain: RequestActionType; action: CommissionerAction }[] = [
  { domain: "approve", action: "approve" },
  { domain: "reapprove", action: "reapprove" },
  { domain: "reject", action: "reject" },
  { domain: "override", action: "override" },
  { domain: "complete_manually", action: "complete" },
  { domain: "reverse", action: "reverse" },
];

// What the domain allows under the settings as they stand and ESPN's week now. While ESPN's week
// can't be read, an approval that still has the lineup to write counts as past its week: it
// can't be judged, and the POST would refuse it.
function allowedNow(
  request: SubRequestRecord,
  writeGate: WriteGate,
  week: TeamWeekRead | null
): RequestActionType[] {
  const matchupEnded =
    week === null || hasMatchupEnded(request, { season: week.meta.season, week: week.week });
  return allowedActions(request, { matchupEnded, writeGate });
}

// The approval the page offers, with the amount it would approve (S4): the one computed from
// ESPN now for a first approval, the held one for a re-approval.
function approvalOffer(
  allowed: RequestActionType[],
  request: SubRequestRecord,
  events: RequestDetail["events"],
  week: TeamWeekRead | null
): ApprovalOffer | null {
  const overrideTenths = request.overrideAdjustmentTenths;
  if (allowed.includes("reapprove")) {
    const held = heldAmountOf(events);
    return held === null ? null : { action: "reapprove", computedTenths: held, overrideTenths };
  }
  if (!allowed.includes("approve") || week === null) return null;
  const computed = amountToApprove(week, request);
  return computed === null ? null : { action: "approve", computedTenths: computed, overrideTenths };
}

// An approval is listed only with its amount, which its form carries.
function commissionerActionsFor(
  request: SubRequestRecord,
  writeGate: WriteGate,
  week: TeamWeekRead | null,
  approval: ApprovalOffer | null
): CommissionerAction[] {
  const allowed = allowedNow(request, writeGate, week);
  return COMMISSIONER_ACTIONS.filter(({ domain }) => allowed.includes(domain))
    .map(({ action }) => action)
    .filter((action) => !isApproval(action) || approval?.action === action);
}

function isApproval(action: CommissionerAction): boolean {
  return action === "approve" || action === "reapprove";
}

// From ESPN as read for this page, since what's left depends on ESPN now: the lineup as it stands,
// and the side's adjustment and reason, which the value to enter must keep (Q5).
function manualStepsFor(
  request: SubRequestRecord,
  snapshots: RequestDetail["snapshots"],
  read: TeamWeekRead | EspnUnavailable | null
): ManualSteps {
  if (read === null) return { status: "not_needed" };
  if ("status" in read) return { status: "unavailable", reason: "espn_unreachable" };
  const side = requestSideNow(read, request);
  if (side === null) return { status: "unavailable", reason: "week_moved_on" };
  const lineupDone = request.lineupState === "verified";
  const moves = lineupDone ? [] : lineupMovesNow(read, request);
  if (moves === null) return { status: "unavailable", reason: "lineup_changed" };

  const delta = request.overrideAdjustmentTenths ?? request.projectedAdjustmentTenths ?? 0;
  const steps = buildManualInstructions({
    lineupMoves: moves,
    lineupDone,
    side: { currentTenths: toTenths(side.adjustment), currentReason: side.adjustmentReason ?? "" },
    deltaTenths: delta,
    reasonEntry: adjustmentReasonEntry(request, delta),
    reasonMaxLength: ADJUSTMENT_REASON_MAX_LENGTH,
  });
  return {
    status: "ready",
    lineupMoves: steps.lineupMoves.map((move) => namedMove(read, move)),
    confirmedMoves: confirmedBeside(read, steps.lineupMoves, snapshots),
    adjustment: adjustmentStepOf(steps.adjustment, side, read),
  };
}

// The request's team's side of its matchup as ESPN has it now; null once ESPN's week has moved
// past the request's matchup.
function requestSideNow(read: TeamWeekRead, request: SubRequestRecord): MatchupSide | null {
  if (read.week.matchupPeriodId !== request.matchupPeriodId) return null;
  const side = [read.matchup?.home, read.matchup?.away].find(
    (each) => each?.teamId === request.teamId
  );
  return side ?? null;
}

function adjustmentStepOf(
  adjustment: ReturnType<typeof buildManualInstructions>["adjustment"],
  side: MatchupSide,
  read: TeamWeekRead
): Extract<ManualSteps, { status: "ready" }>["adjustment"] {
  if (adjustment === null) return null;
  return {
    matchupPeriodId: read.week.matchupPeriodId,
    teamName: read.lineup.teamName,
    currentTenths: toTenths(side.adjustment),
    enterTenths: adjustment.enterTenths,
    reason: adjustment.reason,
    reasonTooLong: adjustment.reason === null,
  };
}

// The edit from the lineup as ESPN has it now, the one the app would send; null once the swap no
// longer fits it.
function lineupMovesNow(read: TeamWeekRead, request: SubRequestRecord): LineupMove[] | null {
  const edit = planLineupEdit({
    lineup: read.lineup,
    injuredPlayerId: request.injuredPlayerId,
    replacementPlayerId: request.replacementPlayerId,
  });
  return edit === null ? null : edit.items;
}

// The edit confirmed at Confirm, while the lineup is still to do and it differs from the edit now.
function confirmedBeside(
  read: TeamWeekRead,
  movesNow: LineupMove[],
  snapshots: RequestDetail["snapshots"]
): NamedMove[] | null {
  const filed = snapshots.find((snapshot) => snapshot.phase === "request");
  const confirmed = confirmedPlanOf(filed?.payload);
  if (confirmed === null || movesNow.length === 0 || isSameEdit(confirmed, movesNow)) return null;
  return confirmed.map((move) => namedMove(read, move));
}

function namedMove(read: TeamWeekRead, move: LineupMove) {
  const { starters, bench, injuredReserve } = read.lineup;
  const player = [...starters, ...bench, ...injuredReserve].find(
    (slot) => slot.player?.playerId === move.playerId
  )?.player;
  return {
    name: player?.name ?? `player ${move.playerId}`,
    fromSlot: move.fromSlot,
    toSlot: move.toSlot,
  };
}

// O1: whether ESPN answers with the owner's credentials and the league's rules match, as of now.
export async function loadEspnStatus(): Promise<EspnStatus> {
  try {
    const { meta, mismatches } = await getWebEspn().checkLeagueRules();
    const state = mismatches.length === 0 ? "working" : "rules_mismatch";
    return { state, mismatches, checkedAt: meta.readAt };
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.commish.espn_failed", { code: error.code });
    return { state: espnStateFor(error.code), mismatches: [], checkedAt: new Date().toISOString() };
  }
}

function espnStateFor(code: EspnError["code"]): EspnStatus["state"] {
  if (code === "credentials_rejected" || code === "not_connected") return code;
  return "unreachable";
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.commish.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
