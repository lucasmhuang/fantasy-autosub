import { commissionerReasonFor, formatTenths, type ReviewReason } from "@injurysub/domain";

// S15: team 1's side to put back by hand, as it was read before the test adjustment.
export function restoreSideText(side: { tenths: number; reason: string }): string {
  const note = side.reason === "" ? "no note" : `the note “${side.reason}”`;
  return `Check team 1’s adjustment on ESPN. If it isn’t ${formatTenths(side.tenths)} points with ${note}, set it back to that.`;
}

// Why a proving request the run itself didn't stop is with the commissioner, in the words of a
// test on team 1: nothing is settled by hand for it, it is cancelled (S19).
const NOT_RUN_REASONS: Partial<Record<ReviewReason, string>> = {
  automation_off: "automation is off",
  not_allowlisted: "team 1 isn’t on the list of teams the worker may change",
  stale: "ESPN changed after it was filed",
  expired: "it waited past its window",
  week_ended: "its matchup week ended",
  playoffs: "team 1 has no opponent this week, or it’s a playoff week",
  lineup_failed: "ESPN didn’t take the swap",
};

export function notRunText(reason: ReviewReason): string {
  const why = NOT_RUN_REASONS[reason] ?? commissionerReasonFor("needs_review", reason) ?? reason;
  return `Not run: ${why}.`;
}

const STOP_STEPS: Record<string, string> = {
  before_swap: "before the swap",
  token: "the test adjustment",
  revert: "the revert",
  restore: "putting the lineup back",
  interrupted: "a restart, mid-run",
};

const STOP_DETAILS: Record<string, string> = {
  not_applied: "ESPN didn’t show it",
  espn_unread: "ESPN couldn’t be read",
  already_noted: "an earlier run’s test note is still on team 1’s side",
  too_long: "the note would be too long",
  not_current: "the matchup is no longer ESPN’s current one",
  day_changed: "ESPN’s day changed",
  automation_off: "automation was turned off",
  not_allowlisted: "team 1 was taken off the worker’s list",
  earlier_write_on_espn: "an earlier try’s swap is on ESPN",
  pass_failed: "the worker kept failing on it",
};

// S15: where a run stopped and what it found there; null for a stop the run didn't make itself.
export function stopText(step: string | null, detail: string | null): string | null {
  if (step === null) return null;
  const where = Object.hasOwn(STOP_STEPS, step) ? STOP_STEPS[step] : step;
  const found =
    detail !== null && Object.hasOwn(STOP_DETAILS, detail) ? STOP_DETAILS[detail] : null;
  return found === null
    ? `Stopped at ${where}. Nothing more was sent.`
    : `Stopped at ${where}: ${found}. Nothing more was sent.`;
}
