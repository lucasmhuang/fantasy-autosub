import type { AdjustmentLine, ReviewReason, SubRequestStatus } from "@injurysub/domain";
import type {
  BoardOption,
  OptionReason,
  OptionStatus,
  OptionWarning,
  TeamBoard,
} from "../../lib/server/board";

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

const OPTION_REASON_TEXT: Record<Exclude<OptionReason, "taken">, string> = {
  other_starters_move:
    "Two or more other starters would have to move, so the commissioner handles this one.",
  suspension: "He's suspended rather than OUT, and the commissioner decides suspensions.",
  no_valid_lineup: "No valid lineup can take him in the injured player's place.",
};

// Why an option isn't Ready now; a taken one names the request still holding him (Dec-D30).
export function optionReasonText(option: Pick<BoardOption, "reason" | "takenFor">): string | null {
  if (option.reason === null) return null;
  if (option.reason === "taken") {
    return `Named in your request for ${option.takenFor ?? "another starter"}, still in progress.`;
  }
  return OPTION_REASON_TEXT[option.reason];
}

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

// S11: while the worker's send mode is never, and on a request whose run sent nothing.
export const REHEARSAL_BAR_TEXT = "Rehearsal: InjurySub isn't sending anything to ESPN.";
export const REHEARSAL_REQUEST_TEXT = "Rehearsal: nothing was sent to ESPN for this request.";

// A request in line while ESPN can't be read (O4), as its manager reads it.
export const DELAYED_LABEL = "Delayed";
export const DELAYED_TEXT =
  "InjurySub can't reach ESPN right now. Your request waits and goes on once it can.";

// Dec-D31c: in line while the worker's beat is stale, so nothing has gone to ESPN.
export const NOT_STARTED_LABEL = "Not started";
export const NOT_STARTED_TEXT = "InjurySub is down, so nothing has been sent.";
// The same, for a request whose swap is already on ESPN and whose adjustment waits.
export const ADJUSTMENT_NOT_SENT_TEXT =
  "InjurySub is down, so the adjustment hasn't been sent yet.";

// X24: the lineup edit sent differs from the one confirmed, as its manager reads it.
export const SENT_EDIT_DIFFERS_TEXT =
  "ESPN's lineup changed after you confirmed, so InjurySub is making the change that fits it now, which still moves at most one other starter.";

// Why a request in line is held up, as the commissioner reads it (O4).
export const ESPN_BLOCK_TEXT: Record<"credentials_rejected" | "unreachable", string> = {
  credentials_rejected:
    "ESPN refused the cookie; renew it and this request runs after a fresh check",
  unreachable: "ESPN isn't answering InjurySub; this request runs once it does",
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
  rearrangement: "Two or more other starters would have to move, so the commissioner handles it.",
  suspension: "He's suspended rather than OUT, and the commissioner decides suspensions.",
  stale: "ESPN changed since the request, so the commissioner will check it.",
  ambiguous: "ESPN's lineup after the change isn't what was asked; the commissioner will check it.",
  lineup_failed: "ESPN didn't take the lineup change; the commissioner will make it by hand.",
  adjustment_failed: "The score adjustment needs the commissioner; they'll enter it by hand.",
  adjustment_held_rules:
    "The league's settings differ from InjurySub's, so the adjustment waits for the commissioner.",
  adjustment_changed: "The adjustment changed since it was approved; the commissioner will look.",
  expired: "It waited too long without being carried out; the commissioner will look at it.",
  week_ended: "Its week ended before it was carried out; the commissioner will settle it.",
  playoffs: "Playoff weeks are handled by the commissioner.",
};
