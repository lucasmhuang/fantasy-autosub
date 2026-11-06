import type { UserRole } from "../auth/roles";
import {
  type ClassifiableLineup,
  classifyReplacementOptions,
  type PlaceableOption,
} from "../lineup/classify-options";
import type { SnapshotSource } from "./events";
import type { SubRequestKind } from "./lifecycle";

// ESPN's injury designations, and anything else it might send.
export type DesignationStatus = "ACTIVE" | "DAY_TO_DAY" | "OUT" | "SUSPENSION" | "unrecognized";

export type RequestEvaluationInput = {
  kind: SubRequestKind;
  requester: { role: UserRole; teamId: number | null };
  teamId: number;
  lineup: ClassifiableLineup;
  injuredPlayerId: number;
  injuredDesignation: DesignationStatus;
  replacementPlayerId: number;
  replacementDay: { tipAt: Date | null; currentTenths: number; final: boolean };
  week: {
    requestDay: number;
    lastDay: number;
    concluded: boolean;
    lastDayLatestTipAt: Date | null;
  };
  moment: Date;
  activeRequestId: string | null;
  provingDoneAt: Date | null;
  attestation: {
    replacementGame: "not_started" | "ended" | "in_progress";
    enteredTenths: number | null;
  } | null;
};

export const requestRefusalReasons = [
  "commissioner_only",
  "not_your_team",
  "own_team_on_behalf",
  "proving_team_only",
  "proving_done",
  "week_over",
  "after_final_game",
  "injured_not_starting",
  "not_out",
  "replacement_not_on_bench",
  "replacement_cannot_start",
  "active_request_exists",
  "attestation_needed",
  "game_had_started",
  "points_needed_mid_game",
  "hand_entry_needs_final_line",
  "hand_entry_out_of_range",
] as const;
export type RequestRefusalReason = (typeof requestRefusalReasons)[number];

// Refusal reasons are stored as text (sub_requests.refusal_reason), so reading one back checks it.
export function isRequestRefusalReason(value: string): value is RequestRefusalReason {
  return (requestRefusalReasons as readonly string[]).includes(value);
}

export type RequestEvaluation =
  | { outcome: "refused"; reason: Exclude<RequestRefusalReason, "active_request_exists"> }
  | { outcome: "refused"; reason: "active_request_exists"; activeRequestId: string }
  | {
      outcome: "valid";
      option: PlaceableOption;
      pointsAtRequest: { tenths: number; source: SnapshotSource };
    };

type Refusal = Exclude<RequestRefusalReason, "active_request_exists">;
type PointsAtRequest = { tenths: number; source: SnapshotSource };

// The proving request runs only on the owner's team, the first one the worker may write to.
const PROVING_TEAM_ID = 1;
// ESPN's day lines carry no in-progress flag, so a matchup's final game counts as over three hours
// after the final day's latest tip time (a heuristic; context.md, behaviors D21).
const FINAL_GAME_LENGTH_MS = 3 * 60 * 60 * 1000;

// Whether a request may be recorded, judged on ESPN's state as the caller read it: ESPN's day,
// never the clock's date. An on-behalf request is judged at its stated moment on the
// commissioner's attestation; the proving request skips the OUT check.
export function evaluateRequest(input: RequestEvaluationInput): RequestEvaluation {
  const refusal = requesterRefusal(input) ?? weekRefusal(input) ?? playerRefusal(input);
  if (refusal !== null) return { outcome: "refused", reason: refusal };
  if (input.kind !== "proving" && input.activeRequestId !== null) {
    return {
      outcome: "refused",
      reason: "active_request_exists",
      activeRequestId: input.activeRequestId,
    };
  }

  const option = replacementOption(input);
  if (option === null) return { outcome: "refused", reason: "replacement_cannot_start" };
  const points = pointsAtRequest(input);
  if ("refusal" in points) return { outcome: "refused", reason: points.refusal };
  return { outcome: "valid", option, pointsAtRequest: points };
}

function requesterRefusal({
  kind,
  requester,
  teamId,
  provingDoneAt,
}: RequestEvaluationInput): Refusal | null {
  if (kind === "substitution") return requester.teamId === teamId ? null : "not_your_team";
  if (requester.role !== "commissioner") return "commissioner_only";
  if (kind === "on_behalf") return requester.teamId === teamId ? "own_team_on_behalf" : null;
  if (teamId !== PROVING_TEAM_ID) return "proving_team_only";
  return provingDoneAt === null ? null : "proving_done";
}

function weekRefusal({ week, moment }: RequestEvaluationInput): Refusal | null {
  if (week.concluded) return "week_over";
  if (week.requestDay !== week.lastDay) return null;
  if (week.lastDayLatestTipAt === null) return "after_final_game";
  const finalGameOver = week.lastDayLatestTipAt.getTime() + FINAL_GAME_LENGTH_MS;
  return moment.getTime() >= finalGameOver ? "after_final_game" : null;
}

function playerRefusal(input: RequestEvaluationInput): Refusal | null {
  const { lineup } = input;
  const starting = lineup.starters.some(({ player }) => player?.playerId === input.injuredPlayerId);
  if (!starting) return "injured_not_starting";
  const designationAllowed =
    input.kind === "proving" ||
    input.injuredDesignation === "OUT" ||
    input.injuredDesignation === "SUSPENSION";
  if (!designationAllowed) return "not_out";
  const benched = lineup.bench.some(({ player }) => player?.playerId === input.replacementPlayerId);
  return benched ? null : "replacement_not_on_bench";
}

function replacementOption(input: RequestEvaluationInput): PlaceableOption | null {
  const result = classifyReplacementOptions({
    lineup: input.lineup,
    injuredPlayerId: input.injuredPlayerId,
  });
  if (!result.ok) return null;
  const option = result.options.find(({ playerId }) => playerId === input.replacementPlayerId);
  return option === undefined || option.kind === "invalid" ? null : option;
}

// The replacement's points before the request: his live line at Confirm; for an on-behalf
// request, what the attestation and the schedule allow.
function pointsAtRequest(input: RequestEvaluationInput): PointsAtRequest | { refusal: Refusal } {
  const { replacementDay: day } = input;
  if (input.kind !== "on_behalf") return { tenths: day.currentTenths, source: "observed" };
  if (input.attestation === null) return { refusal: "attestation_needed" };

  const { replacementGame, enteredTenths } = input.attestation;
  if (replacementGame === "not_started") {
    const tipped = day.tipAt !== null && input.moment.getTime() >= day.tipAt.getTime();
    return tipped ? { refusal: "game_had_started" } : { tenths: 0, source: "observed" };
  }
  if (replacementGame === "ended") return { tenths: day.currentTenths, source: "observed" };
  if (enteredTenths === null) return { refusal: "points_needed_mid_game" };
  if (!day.final) return { refusal: "hand_entry_needs_final_line" };
  const inRange = enteredTenths >= 0 && enteredTenths <= day.currentTenths;
  return inRange
    ? { tenths: enteredTenths, source: "entered_by_hand" }
    : { refusal: "hand_entry_out_of_range" };
}
