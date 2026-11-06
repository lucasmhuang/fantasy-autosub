import type { AdjustmentLine, SubRequestStatus } from "@injurysub/domain";
import type { OptionReason, OptionStatus, OptionWarning, TeamBoard } from "../../lib/server/board";

// Why there's no board to show (behaviors D18-D20, D22). In 5a nothing alerts the commissioner
// when ESPN refuses the credentials (that's 5c), so D19's message doesn't say they were told.
export const NO_BOARD_TEXT: Record<Exclude<TeamBoard["status"], "board">, string> = {
  not_connected: "ESPN isn't connected yet, so there's nothing to request here for now.",
  unavailable: "ESPN can't be reached right now. Try again shortly.",
  credentials_rejected: "The app can't reach ESPN right now. Try again later.",
  season_over: "The season's last matchup week is over, so there's nothing left to request.",
};

// Each line of a projected adjustment, after the player's name.
export const ADJUSTMENT_LINE_TEXT: Record<AdjustmentLine["why"], string> = {
  injured_credited_before_swap: "points while starting, before the swap",
  earlier_credit_forfeited: "credit from an earlier substitution",
  replacement_after_request: "points after the request",
  replacement_on_bench: "bench points after the request",
  replacement_before_request: "points before the request, which don't count",
};

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
