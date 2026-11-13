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
