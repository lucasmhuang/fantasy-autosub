import type { SubRequestStatus } from "@injurysub/domain";
import type { OptionReason, OptionStatus, OptionWarning } from "../../lib/server/board";

export const OPTION_STATUS_LABELS: Record<OptionStatus, string> = {
  ready_now: "Ready now",
  review_required: "Review required",
  not_valid: "Not valid",
};

export const OPTION_REASON_TEXT: Record<OptionReason, string> = {
  other_starters_move: "Other starters would have to move, so the commissioner handles this one.",
  suspension: "He's suspended rather than OUT, and the commissioner decides suspensions.",
  no_valid_lineup: "No valid lineup can take him in the injured player's place.",
  taken: "Another request this week already names him.",
};

export const OPTION_WARNING_TEXT: Record<OptionWarning, string> = {
  no_games_left: "He has no games left this week, so he can't add points.",
  already_scored: "He has points this week; any from before the request won't count.",
};

// What a manager sees for their request's status.
export const REQUEST_STATUS_LABELS: Record<SubRequestStatus, string> = {
  refused: "Refused",
  awaiting_approval: "Waiting for the commissioner's approval",
  queued: "In line",
  executing: "In progress",
  needs_review: "Waiting for the commissioner",
  completed: "Done",
  completed_manually: "Done by the commissioner",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  reversed: "Reversed",
};

export const OPTION_STATUS_COLORS: Record<OptionStatus, { background: string; color: string }> = {
  ready_now: { background: "rgba(136, 228, 159, 0.14)", color: "var(--success)" },
  review_required: { background: "rgba(255, 202, 107, 0.14)", color: "var(--warning)" },
  not_valid: { background: "rgba(255, 134, 125, 0.14)", color: "var(--danger)" },
};
