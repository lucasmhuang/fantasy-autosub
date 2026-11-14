import { commissionerReasonFor, type ReviewReason, reviewReasons } from "@injurysub/domain";

const SELF_APPROVAL_NOTE = " (their own team's request)";

// What the record shows after an event's name: why it went to review, in the commissioner's
// words; a commissioner's typed reason; or that an approval was of the commissioner's own team's
// request (Q12).
export function recordNote({
  eventType,
  payload,
}: {
  eventType: string;
  payload: unknown;
}): string {
  if (typeof payload !== "object" || payload === null) return "";
  if ("reason" in payload && typeof payload.reason === "string") {
    const why = eventType === "sent_to_review" ? reviewSummaryOf(payload.reason) : payload.reason;
    return `: ${why}`;
  }
  return "selfApproval" in payload && payload.selfApproval === true ? SELF_APPROVAL_NOTE : "";
}

function reviewSummaryOf(reason: string): string {
  const known = (reviewReasons as readonly string[]).includes(reason);
  return known ? (commissionerReasonFor("needs_review", reason as ReviewReason) ?? reason) : reason;
}
