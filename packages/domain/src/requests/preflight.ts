import type { ClassifiableLineup } from "../lineup/classify-options";
import type { SubRequestKind } from "./lifecycle";
import { isAutomatableEdit, type LineupEdit, planLineupEdit } from "./lineup-edit";

export type PreflightCheck =
  | { ok: true; edit: LineupEdit }
  | { ok: false; detail: "designation_changed" | "no_automatable_edit" };

// The designation a request was accepted on: ESPN's at the request for a manager's request (OUT,
// or SUSPENSION once the commissioner approved a suspension), and ESPN's at filing for an
// on-behalf request, which was accepted on the commissioner's attestation (AC2-2).
export function acceptedDesignationOf(request: {
  kind: SubRequestKind;
  designationAtRequest: string;
  designationAtFiling: string | null;
}): string {
  if (request.kind !== "on_behalf") return request.designationAtRequest;
  if (request.designationAtFiling === null) {
    throw new RangeError("An on-behalf request has no designation at filing.");
  }
  return request.designationAtFiling;
}

// Whether a request's plan still holds on ESPN's lineup now (X6, X7, X24): the starter still
// carries the designation the request was accepted on, and an edit the app may send on its own
// still puts the replacement in. The edit is worked out again from this lineup, so it's the one
// sent even if it differs from the one confirmed (Dec-D29b).
export function checkPlanStillHolds(input: {
  lineup: ClassifiableLineup;
  injuredPlayerId: number;
  replacementPlayerId: number;
  acceptedDesignation: string;
  currentDesignation: string;
}): PreflightCheck {
  if (input.currentDesignation !== input.acceptedDesignation) {
    return { ok: false, detail: "designation_changed" };
  }
  const edit = planLineupEdit(input);
  if (edit === null || !isAutomatableEdit(edit))
    return { ok: false, detail: "no_automatable_edit" };
  return { ok: true, edit };
}

// A player on next week's first day, as ESPN reads it (a slot name, IR included).
export type NextWeekPlayer = { playerId: number; slot: string };

export type NextWeekOverLimit = { activeAfter: number; activeLimit: number; offIr: number[] };

// Whether the swap would put next week's roster over ESPN's limit. A player the swap puts on the
// bench or in a starting slot this week is taken to count as off IR next week too, even where the
// manager has already put him on IR there: a hypothesis that fits ESPN refusing team 6's swap as
// exactly one over (2026-11-18) and a team-1 probe, not seen directly. Every player off IR counts,
// the bench included. Null when next week still fits.
export function nextWeekOverLimit(input: {
  nextWeek: readonly NextWeekPlayer[];
  movedPlayerIds: readonly number[];
  activeLimit: number;
}): NextWeekOverLimit | null {
  const offIr = input.nextWeek
    .filter((player) => player.slot === "IR" && input.movedPlayerIds.includes(player.playerId))
    .map((player) => player.playerId);
  if (offIr.length === 0) return null;
  const activeAfter = input.nextWeek.filter((player) => player.slot !== "IR").length + offIr.length;
  return activeAfter > input.activeLimit
    ? { activeAfter, activeLimit: input.activeLimit, offIr }
    : null;
}
