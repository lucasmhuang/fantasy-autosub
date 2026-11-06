import type { AdjustmentLine, ReviewReason, SubRequestStatus } from "@injurysub/domain";
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

// Each status chip: its token, and the same token faded for the background.
export const OPTION_STATUS_COLORS: Record<OptionStatus, { background: string; color: string }> = {
  ready_now: {
    background: "color-mix(in srgb, var(--success) 14%, transparent)",
    color: "var(--success)",
  },
  review_required: {
    background: "color-mix(in srgb, var(--warning) 14%, transparent)",
    color: "var(--warning)",
  },
  not_valid: {
    background: "color-mix(in srgb, var(--danger) 14%, transparent)",
    color: "var(--danger)",
  },
};

// Why a request waits for the commissioner, as its manager reads it.
export const REVIEW_REASON_TEXT: Record<ReviewReason, string> = {
  automation_off: "Automation is off, so the commissioner handles it.",
  not_allowlisted: "The app doesn't change this team's lineup yet, so the commissioner handles it.",
  rearrangement: "Other starters would have to move, so the commissioner handles it.",
  suspension: "He's suspended rather than OUT, and the commissioner decides suspensions.",
  stale: "ESPN changed since the request, so the commissioner will check it.",
  ambiguous: "ESPN's lineup after the change isn't what was asked; the commissioner will check it.",
  lineup_failed: "ESPN refused the lineup change; the commissioner will make it by hand.",
  adjustment_failed: "ESPN refused the score adjustment; the commissioner will enter it by hand.",
  adjustment_held_rules:
    "The league's settings differ from InjurySub's, so the adjustment waits for the commissioner.",
  adjustment_changed: "The adjustment changed since it was approved; the commissioner will look.",
  expired: "It waited too long without being carried out; the commissioner will look at it.",
  week_ended: "Its week ended before it was carried out; the commissioner will settle it.",
  playoffs: "Playoff weeks are handled by the commissioner.",
};
