import type { DesignationStatus } from "./eligibility";
import type { ReviewReason, SubRequestKind, SubRequestStatus, WriteGate } from "./lifecycle";

export const leagueExecutionModes = ["approval_required", "auto"] as const;
export type LeagueExecutionMode = (typeof leagueExecutionModes)[number];

export type RoutingInput = {
  kind: SubRequestKind;
  teamId: number;
  optionKind: "direct" | "rearrangement";
  injuredDesignation: DesignationStatus;
  period: { isPlayoffs: boolean; hasOpponent: boolean };
  allowlist: readonly number[];
  mode: LeagueExecutionMode;
};

export type RoutedRequest = {
  status: Extract<SubRequestStatus, "queued" | "awaiting_approval" | "needs_review">;
  reviewReason: ReviewReason | null;
};

// Where a valid request goes. What can't be automated goes to the commissioner first: a playoff
// week or a bye, a rearrangement (step 6), then a suspension (the commissioner's call). Then the
// two gates, in the same order everywhere: the allowlist (empty means automation is off), then
// the execution mode. The proving request is routed by the gates alone.
export function routeRequest(input: RoutingInput): RoutedRequest {
  const held = heldForTheCommissioner(input);
  if (held !== null) return { status: "needs_review", reviewReason: held };
  const gate = writeGateFor(input.allowlist, input.teamId);
  if (gate !== "open") return { status: "needs_review", reviewReason: gate };
  return input.mode === "approval_required"
    ? { status: "awaiting_approval", reviewReason: null }
    : { status: "queued", reviewReason: null };
}

function heldForTheCommissioner(input: RoutingInput): ReviewReason | null {
  if (input.kind === "proving") return null;
  if (input.period.isPlayoffs || !input.period.hasOpponent) return "playoffs";
  if (input.optionKind === "rearrangement") return "rearrangement";
  return input.injuredDesignation === "SUSPENSION" ? "suspension" : null;
}

// Gate 2 (behaviors, "Write-gate precedence"): an empty allowlist means automation is off.
export function writeGateFor(allowlist: readonly number[], teamId: number): WriteGate {
  if (allowlist.length === 0) return "automation_off";
  return allowlist.includes(teamId) ? "open" : "not_allowlisted";
}
