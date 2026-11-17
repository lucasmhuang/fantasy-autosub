import {
  type AlertEmailState,
  describeFailure,
  findRequestAlertEmailState,
  findTeamManagerName,
  findUserDisplayName,
  getEspnAccess,
  getRequestDetail,
  isDatabaseQueryError,
  listTeamNames,
  NEEDS_THE_COMMISSIONER,
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
  espnBlockFor,
  hasMatchupEnded,
  isSameEdit,
  type LineupMove,
  planLineupEdit,
  type RequestActionType,
  type RequestSnapshotPhase,
  requestAmountTenths,
  type SubRequestStatus,
  toTenths,
  type WriteGate,
  writeGateFor,
} from "@injurysub/domain";
import type { MatchupSide, TeamWeekRead } from "@injurysub/espn";
import { z } from "zod";
import { type EspnUnavailable, readTeamWeek } from "./board";
import type { CommissionerAction } from "./commish-actions";
import { amountToApprove, earlierCreditOf, heldAmountOf } from "./commish-approval";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";
import { type ReviewFacts, reviewFactsOf } from "./queue";
import { type BreakdownLine, breakdownOf, REQUEST_ID } from "./request-view";
import type { Attestation } from "./requests";

export type ManualSteps =
  | { status: "not_needed" }
  // When ESPN was read, or the read failed (FM-DETAIL-1); past its matchup, this request's own
  // amount, which the commissioner adds to what ESPN already holds (FM-DETAIL-3).
  | { status: "unavailable"; reason: "espn_unreachable"; readAt: Date }
  | { status: "unavailable"; reason: "week_moved_on"; readAt: Date; deltaTenths: number }
  | {
      status: "ready";
      readAt: Date;
      lineupMoves: NamedMove[];
      // The swap no longer fits ESPN's lineup: where the starter is now (FM-DETAIL-2).
      lineupNoLongerFits: { starterSlot: string } | null;
      // When the lineup was read back done on ESPN (FS-DETAIL-8).
      lineupDoneAt: Date | null;
      // The edit confirmed, when it differs from the one the lineup now gives (Dec-D29b).
      confirmedMoves: NamedMove[] | null;
      // A20: the starter came in through this earlier request, so the amount is the commissioner's
      // to work out; no amount is offered until their override is set.
      heldForEarlier: { earlierRequestId: string } | null;
      // Where ESPN's Scoreboard shows it: the matchup period's number and the team's name now.
      adjustment: {
        matchupPeriodId: number;
        teamName: string;
        currentTenths: number;
        // This request's own amount; enterTenths is the side's new total with it.
        deltaTenths: number;
        enterTenths: number;
        reason: string | null;
        reasonTooLong: boolean;
      } | null;
    };

type NamedMove = { playerId: number; name: string; fromSlot: string; toSlot: string };

export type RequestDetailView =
  | { status: "not_found" | "unavailable" | "proving" }
  | {
      status: "found";
      request: SubRequestRecord;
      why: string | null;
      blocked: "credentials_rejected" | "unreachable" | "not_connected" | null;
      // When ESPN's access began holding it up.
      blockedSince: Date | null;
      // What its review reason's sentence names (shared with the queue's row).
      facts: ReviewFacts | null;
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
      // The team's name as ESPN shows it, and the manager's: whoever asked, or for a filing on a
      // team's behalf, whoever holds the team now (the request records the commissioner).
      names: { team: string | null; manager: string | null };
      // Whether the commissioner's email about it went out, while it waits on them (FS-DETAIL-18).
      alertEmail: AlertEmailState;
      // What an approval would send now (FS-DETAIL-4); null with no approval on offer.
      sends: ApprovalSends | null;
      // A done request's side on ESPN now and the value that takes its amount back off
      // (FS-DETAIL-15); null when not done, or when ESPN can't show the matchup.
      reversal: { currentTenths: number; enterTenths: number; appliedTenths: number } | null;
    };

export type ApprovalSends = {
  moves: { playerId: number; name: string; fromSlot: string; toSlot: string }[];
  amountTenths: number;
  // The side's total on ESPN now, and once the amount is posted.
  sideBeforeTenths: number;
  sideAfterTenths: number;
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

const completionSchema = z.object({ computedTenths: z.number().int().nullable() });
const filedSchema = z.object({
  attestation: z.object({
    replacementGame: z.enum(["not_started", "ended", "in_progress"]),
    enteredTenths: z.number().int().nullable(),
    note: z.string().nullable(),
  }),
});

// One request's whole record (H2), why it needs the commissioner, and what's left to do by hand
// on ESPN (Q4, Q5).
export async function loadRequestDetail(input: { requestId: string }): Promise<RequestDetailView> {
  if (!REQUEST_ID.test(input.requestId)) return { status: "not_found" };
  const stored = await readStored(input.requestId);
  if (stored === "unavailable") return { status: "unavailable" };
  const { detail, access, allowlist, names, alertEmail } = stored;
  if (detail === null) return { status: "not_found" };
  // A test run on team 1 has its own page (S20).
  if (detail.request.kind === "proving") return { status: "proving" };
  const { request, snapshots, events } = detail;
  // Read live, once, for what's left by hand, what can be approved, and what undoes a done one.
  const read =
    NEEDS_THE_COMMISSIONER.includes(request.status) || REVERSIBLE.includes(request.status)
      ? await readTeamWeek(request.teamId)
      : null;
  const week = read === null || "status" in read ? null : read;
  const gate = writeGateFor(allowlist, request.teamId);
  const approval = approvalOffer(allowedNow(request, gate, week), request, events, week);
  return {
    status: "found",
    request,
    why: commissionerReasonFor(request.status, request.reviewReason),
    blocked: espnBlockFor(request.status, access?.state ?? null),
    blockedSince:
      espnBlockFor(request.status, access?.state ?? null) === null ? null : (access?.since ?? null),
    facts: request.status === "needs_review" ? reviewFactsOf(detail) : null,
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
    instructions: manualStepsFor(
      detail,
      NEEDS_THE_COMMISSIONER.includes(request.status) ? read : null,
      new Date()
    ),
    reversal: reversalOf(request, week),
    adjustment: adjustmentFiguresOf(request, events),
    filing: filingOf(request, events),
    names: { ...names, team: names.team ?? week?.lineup.teamName ?? null },
    alertEmail,
    sends: approvalSends(request, week, approval),
  };
}

// The edit an approval would send and the amount it would post, against the side's total now.
function approvalSends(
  request: SubRequestRecord,
  week: TeamWeekRead | null,
  approval: ApprovalOffer | null
): ApprovalSends | null {
  if (approval?.action !== "approve" || week === null) return null;
  const side = requestSideNow(week, request);
  const moves = lineupMovesNow(week, request);
  if (side === null || moves === null) return null;
  const amountTenths = approval.overrideTenths ?? approval.computedTenths;
  const sideBeforeTenths = toTenths(side.score);
  return {
    moves: moves.map((move) => namedMove(week, move)),
    amountTenths,
    sideBeforeTenths,
    sideAfterTenths: sideBeforeTenths + amountTenths,
  };
}

// The request's record, ESPN's access state and the teams automation covers, from the database.
async function readStored(requestId: string) {
  try {
    const { db } = getWebDatabaseConnection();
    const detail = await getRequestDetail(db, requestId);
    if (detail === null)
      return { detail, access: null, allowlist: [], names: NO_NAMES, alertEmail: UNKNOWN_EMAIL };
    const access = await getEspnAccess(db);
    const allowlist = (await readLeagueSettings(db)).writeAllowlist;
    const { request } = detail;
    const team = (await listTeamNames(db)).find((each) => each.teamId === request.teamId);
    const manager =
      request.kind === "on_behalf"
        ? await findTeamManagerName(db, request.teamId)
        : await findUserDisplayName(db, request.requestedBy);
    const alertEmail = NEEDS_THE_COMMISSIONER.includes(request.status)
      ? await findRequestAlertEmailState(db, request.requestId)
      : UNKNOWN_EMAIL;
    return { detail, access, allowlist, names: { team: team?.name ?? null, manager }, alertEmail };
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
  { request, snapshots, events }: RequestDetail,
  read: TeamWeekRead | EspnUnavailable | null,
  now: Date
): ManualSteps {
  if (read === null) return { status: "not_needed" };
  if ("status" in read) return { status: "unavailable", reason: "espn_unreachable", readAt: now };
  const readAt = new Date(read.meta.readAt);
  // A20: held for an earlier credit, no amount is offered until the commissioner sets one.
  const heldForEarlier = earlierCreditOf(events);
  const projected = heldForEarlier === null ? (request.projectedAdjustmentTenths ?? 0) : 0;
  const delta = request.overrideAdjustmentTenths ?? projected;
  const side = requestSideNow(read, request);
  if (side === null) {
    return { status: "unavailable", reason: "week_moved_on", readAt, deltaTenths: delta };
  }
  const lineupDone = request.lineupState === "verified";
  const moves = lineupDone ? [] : lineupMovesNow(read, request);
  const steps = buildManualInstructions({
    lineupMoves: moves ?? [],
    lineupDone: lineupDone || moves === null,
    side: { currentTenths: toTenths(side.adjustment), currentReason: side.adjustmentReason ?? "" },
    deltaTenths: delta,
    reasonEntry: adjustmentReasonEntry(request, delta),
    reasonMaxLength: ADJUSTMENT_REASON_MAX_LENGTH,
  });
  return {
    status: "ready",
    readAt,
    lineupMoves: steps.lineupMoves.map((move) => namedMove(read, move)),
    lineupNoLongerFits:
      moves === null ? { starterSlot: slotOf(read, request.injuredPlayerId) } : null,
    lineupDoneAt: lineupDone ? lastEventAt(events, "lineup_verified") : null,
    confirmedMoves: confirmedBeside(read, steps.lineupMoves, snapshots),
    heldForEarlier,
    adjustment: adjustmentStepOf(steps.adjustment, side, read, delta),
  };
}

// Where a player is in ESPN's lineup now ("BE", "IR", a starting slot), or "off the roster".
function slotOf(read: TeamWeekRead, playerId: number): string {
  const { starters, bench, injuredReserve } = read.lineup;
  const slot = [...starters, ...bench, ...injuredReserve].find(
    (each) => each.player?.playerId === playerId
  );
  return slot?.slot ?? "off the roster";
}

function lastEventAt(events: RequestDetail["events"], type: string): Date | null {
  return events.findLast((event) => event.eventType === type)?.createdAt ?? null;
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
  read: TeamWeekRead,
  deltaTenths: number
): Extract<ManualSteps, { status: "ready" }>["adjustment"] {
  if (adjustment === null) return null;
  return {
    matchupPeriodId: read.week.matchupPeriodId,
    teamName: read.lineup.teamName,
    currentTenths: toTenths(side.adjustment),
    deltaTenths,
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

const NO_NAMES = { team: null, manager: null };
const REVERSIBLE: readonly SubRequestStatus[] = ["completed", "completed_manually"];

function reversalOf(
  request: SubRequestRecord,
  week: TeamWeekRead | null
): { currentTenths: number; enterTenths: number; appliedTenths: number } | null {
  if (!REVERSIBLE.includes(request.status) || week === null) return null;
  const side = requestSideNow(week, request);
  if (side === null) return null;
  const currentTenths = toTenths(side.adjustment);
  const appliedTenths = requestAmountTenths(request) ?? 0;
  return { currentTenths, enterTenths: currentTenths - appliedTenths, appliedTenths };
}
const UNKNOWN_EMAIL: AlertEmailState = { state: "unknown" };

function namedMove(read: TeamWeekRead, move: LineupMove) {
  const { starters, bench, injuredReserve } = read.lineup;
  const player = [...starters, ...bench, ...injuredReserve].find(
    (slot) => slot.player?.playerId === move.playerId
  )?.player;
  return {
    playerId: move.playerId,
    name: player?.name ?? `player ${move.playerId}`,
    fromSlot: move.fromSlot,
    toSlot: move.toSlot,
  };
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.commish.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
