const SELF_APPROVAL_NOTE = " (their own team's request)";

// What the record shows after an event's name: a commissioner's typed reason, or that an approval
// was of the commissioner's own team's request (Q12).
export function recordNote(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  if ("reason" in payload && typeof payload.reason === "string") return `: ${payload.reason}`;
  return "selfApproval" in payload && payload.selfApproval === true ? SELF_APPROVAL_NOTE : "";
}
