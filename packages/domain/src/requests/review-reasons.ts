import type { ReviewReason, SubRequestStatus } from "./lifecycle";

// Why a request in review needs the commissioner, as a clause for an email or a page:
// "A request from team 5 needs you: <summary>."
const REVIEW_REASON_SUMMARIES: Record<ReviewReason, string> = {
  automation_off: "automation is off, so it waits for you to settle it by hand",
  not_allowlisted: "the worker may not change this team's lineup yet, so settle it by hand",
  rearrangement: "the replacement fits only if other starters move, which you settle by hand",
  suspension: "the starter is suspended rather than OUT: approve it or settle it by hand",
  stale: "ESPN changed since the request, so nothing was written; check it before approving",
  ambiguous: "ESPN's lineup after the edit isn't what was asked; check it and settle it by hand",
  lineup_failed: "ESPN didn't take the lineup edit; settle it by hand",
  adjustment_failed: "the adjustment wasn't written; enter it by hand",
  adjustment_held_rules: "the league's rules differ from InjurySub's, so the adjustment is held",
  adjustment_changed: "the adjustment changed since you approved it; approve the new amount",
  expired: "it waited past its window without being carried out",
  week_ended: "its matchup week ended before it was carried out; settle it by hand",
  playoffs: "it's in a playoff week or the team has no opponent; settle it by hand",
};

// Null for a request that doesn't need the commissioner.
export function commissionerReasonFor(
  status: SubRequestStatus,
  reviewReason: ReviewReason | null
): string | null {
  if (status === "awaiting_approval") return "it waits for your approval";
  if (status !== "needs_review" || reviewReason === null) return null;
  return REVIEW_REASON_SUMMARIES[reviewReason];
}
