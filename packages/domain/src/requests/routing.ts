import type { DesignationStatus } from "./eligibility";
import type { ReviewReason, SubRequestKind, SubRequestStatus, WriteGate } from "./lifecycle";
import { isAutomatableEdit, type LineupEdit } from "./lineup-edit";

export const leagueExecutionModes = ["approval_required", "auto"] as const;
export type LeagueExecutionMode = (typeof leagueExecutionModes)[number];

export type RoutingInput = {
  kind: SubRequestKind;
  teamId: number;
  edit: LineupEdit;
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
// week or a bye, then whatever the option itself leaves to them (`optionHoldFor`). Then the two
// gates, in the same order everywhere: the allowlist (empty means automation is off), then the
// execution mode. The proving request skips only the option's hold (it may name any starter): a
// week without an opponent has no side to take its test adjustment.
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
  if (input.period.isPlayoffs || !input.period.hasOpponent) return "playoffs";
  return input.kind === "proving" ? null : optionHoldFor(input);
}

// What a replacement option leaves to the commissioner, as Confirm routes it and the board shows
// it: an edit moving two or more other starters (step 6; Dec-D28), then a suspension (the
// commissioner's call). A direct swap, a one-move rearrangement and a replacement taking an open
// starting slot are automated alike.
export function optionHoldFor(input: {
  edit: LineupEdit;
  injuredDesignation: DesignationStatus;
}): "rearrangement" | "suspension" | null {
  if (!isAutomatableEdit(input.edit)) return "rearrangement";
  return input.injuredDesignation === "SUSPENSION" ? "suspension" : null;
}

// Gate 2 (behaviors, "Write-gate precedence"): an empty allowlist means automation is off.
export function writeGateFor(allowlist: readonly number[], teamId: number): WriteGate {
  if (allowlist.length === 0) return "automation_off";
  return allowlist.includes(teamId) ? "open" : "not_allowlisted";
}
