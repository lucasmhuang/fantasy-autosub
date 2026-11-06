import {
  describeFailure,
  getRequestDetail,
  isDatabaseQueryError,
  listCommissionerQueue,
  type RequestDetail,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  allowedActions,
  buildManualInstructions,
  classifyReplacementOptions,
  commissionerReasonFor,
  formatTenths,
  type LineupMove,
  lineupMovesFor,
  type RequestActionType,
  type RequestSnapshotPhase,
  type SubRequestStatus,
  toTenths,
} from "@injurysub/domain";
import { EspnError, type RuleMismatch, type TeamWeekRead } from "@injurysub/espn";
import { z } from "zod";
import { readTeamWeek } from "./board";
import type { CommissionerAction } from "./commish-actions";
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
      lineupMoves: { name: string; fromSlot: string; toSlot: string }[];
      adjustment: {
        currentTenths: number;
        enterTenths: number;
        reason: string | null;
        reasonTooLong: boolean;
      } | null;
    };

export type RequestDetailView =
  | { status: "not_found" | "unavailable" }
  | {
      status: "found";
      request: SubRequestRecord;
      why: string | null;
      // What the commissioner may do with it now, in this step (approve comes with 5b).
      actions: CommissionerAction[];
      breakdown: BreakdownLine[];
      events: { eventType: string; actorType: string; createdAt: Date; payload: unknown }[];
      snapshots: { phase: RequestSnapshotPhase; espnDay: number; takenAt: Date }[];
      instructions: ManualSteps;
      adjustment: AdjustmentFigures;
      filing: OnBehalfFiling | null;
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
// HYPOTHESIS until B13 measures ESPN's limit on an adjustment reason: no limit has been observed;
// 255 is a guess, and the instructions say the limit is unconfirmed.
export const PROVISIONAL_REASON_MAX_LENGTH = 255;
const momentFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Every team's requests, those needing the commissioner first (Q3).
export async function loadCommissionerQueue(): Promise<CommissionerQueue> {
  try {
    const rows = await listCommissionerQueue(getWebDatabaseConnection().db);
    return { status: "found", requests: rows.map(queueEntryOf) };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "queue");
    return { status: "unavailable" };
  }
}

function queueEntryOf(row: SubRequestRecord): QueueEntry {
  return {
    requestId: row.requestId,
    teamId: row.teamId,
    injuredName: row.injuredName,
    replacementName: row.replacementName,
    status: row.status,
    needsAction: NEEDS_THE_COMMISSIONER.includes(row.status),
    why: commissionerReasonFor(row.status, row.reviewReason),
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
  let detail: RequestDetail | null;
  try {
    detail = await getRequestDetail(getWebDatabaseConnection().db, input.requestId);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "request_detail");
    return { status: "unavailable" };
  }
  if (detail === null) return { status: "not_found" };
  const { request, snapshots, events } = detail;
  return {
    status: "found",
    request,
    why: commissionerReasonFor(request.status, request.reviewReason),
    actions: commissionerActionsFor(request),
    breakdown: breakdownOf(request, snapshots.find((each) => each.phase === "request")?.payload),
    events: events.map(({ eventType, actorType, createdAt, payload }) => ({
      eventType,
      actorType,
      createdAt,
      payload,
    })),
    snapshots: snapshots.map(({ phase, espnDay, takenAt }) => ({ phase, espnDay, takenAt })),
    instructions: await manualStepsFor(request),
    adjustment: adjustmentFiguresOf(request, events),
    filing: filingOf(request, events),
  };
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
  { domain: "reject", action: "reject" },
  { domain: "override", action: "override" },
  { domain: "complete_manually", action: "complete" },
  { domain: "reverse", action: "reverse" },
];

function commissionerActionsFor(request: SubRequestRecord): CommissionerAction[] {
  const allowed = allowedActions(request, { matchupEnded: false, writeGate: "open" });
  return COMMISSIONER_ACTIONS.filter(({ domain }) => allowed.includes(domain)).map(
    ({ action }) => action
  );
}

// Read live, since what's left depends on ESPN now: the lineup as it stands, and the side's
// adjustment and reason, which the value to enter must keep (Q5).
async function manualStepsFor(request: SubRequestRecord): Promise<ManualSteps> {
  if (!NEEDS_THE_COMMISSIONER.includes(request.status)) return { status: "not_needed" };
  const read = await readTeamWeek(request.teamId);
  if ("status" in read) return { status: "unavailable", reason: "espn_unreachable" };
  const side = [read.matchup?.home, read.matchup?.away].find(
    (each) => each?.teamId === request.teamId
  );
  if (
    read.week.matchupPeriodId !== request.matchupPeriodId ||
    side === undefined ||
    side === null
  ) {
    return { status: "unavailable", reason: "week_moved_on" };
  }
  const lineupDone = request.lineupState === "verified";
  const moves = lineupDone ? [] : lineupMovesNow(read, request);
  if (moves === null) return { status: "unavailable", reason: "lineup_changed" };

  const delta = request.overrideAdjustmentTenths ?? request.projectedAdjustmentTenths ?? 0;
  const steps = buildManualInstructions({
    lineupMoves: moves,
    lineupDone,
    side: { currentTenths: toTenths(side.adjustment), currentReason: side.adjustmentReason ?? "" },
    deltaTenths: delta,
    reasonEntry: reasonEntryFor(request, delta),
    reasonMaxLength: PROVISIONAL_REASON_MAX_LENGTH,
  });
  return {
    status: "ready",
    lineupMoves: steps.lineupMoves.map((move) => namedMove(read, move)),
    adjustment:
      steps.adjustment === null
        ? null
        : {
            currentTenths: toTenths(side.adjustment),
            enterTenths: steps.adjustment.enterTenths,
            reason: steps.adjustment.reason,
            reasonTooLong: steps.adjustment.reason === null,
          },
  };
}

// The edit from the lineup as ESPN has it now; null once the swap no longer fits it.
function lineupMovesNow(read: TeamWeekRead, request: SubRequestRecord): LineupMove[] | null {
  const injured = read.lineup.starters.find(
    ({ player }) => player?.playerId === request.injuredPlayerId
  );
  const result = classifyReplacementOptions({
    lineup: read.lineup,
    injuredPlayerId: request.injuredPlayerId,
  });
  if (injured === undefined || !result.ok) return null;
  const option = result.options.find(({ playerId }) => playerId === request.replacementPlayerId);
  if (option === undefined || option.kind === "invalid") return null;
  return lineupMovesFor({ playerId: request.injuredPlayerId, slot: injured.slot }, option);
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

// This request's entry in the side's adjustment reason, e.g. "Injury sub requested Tue 10/27,
// 7:10 PM PT: Toumani Camara for Jaren Jackson Jr., +5.1".
function reasonEntryFor(request: SubRequestRecord, deltaTenths: number): string {
  const moment = `${momentFormat.format(request.requestMoment)} PT`;
  const amount = formatTenths(deltaTenths, { signed: true });
  return `Injury sub requested ${moment}: ${request.replacementName} for ${request.injuredName}, ${amount}`;
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
