import {
  formatMoment,
  formatTenths,
  REASON_PILLS,
  type ReviewReason,
  slotLabel,
} from "@injurysub/domain";
import type { TeamBoard } from "../../lib/server/board";
import type { NamedMove, ProvingWrite } from "../../lib/server/proving";
import { surname } from "../board/option-copy";

// Why there's no team 1 board to pick a proving swap from.
export const NO_BOARD_TEXT: Record<Exclude<TeamBoard["status"], "board">, string> = {
  not_connected: "No ESPN cookie yet.",
  unavailable: "ESPN can't be reached right now. Try again shortly.",
  credentials_rejected: "ESPN refused the cookie.",
  season_over: "The season's last matchup week is over, so there's nothing left to request.",
  worker_down: "Can't load your team right now.",
  database_down: "Can't load InjurySub right now.",
};

export const REHEARSAL_REQUEST_TEXT = "Rehearsal: nothing was sent to ESPN for this request.";

// S15: team 1's side to put back by hand, as it was read before the test adjustment.
export function restoreSideText(side: { tenths: number; reason: string }): string {
  const note = side.reason === "" ? "no note" : `the note “${side.reason}”`;
  return `Check your team’s adjustment on ESPN. If it isn’t ${formatTenths(side.tenths)} points with ${note}, set it back to that.`;
}

// Why a proving request the run itself didn't stop is with the commissioner, in the words of a
// test on team 1: nothing is settled by hand for it, it is cancelled (S19).
const NOT_RUN_REASONS: Partial<Record<ReviewReason, string>> = {
  automation_off: "automation is off",
  not_allowlisted: "your team isn’t ticked",
  stale: "ESPN changed after it was filed",
  expired: "it waited past its window",
  week_ended: "its matchup week ended",
  playoffs: "your team has no opponent this week, or it’s a playoff week",
  lineup_failed: "ESPN didn’t take the swap",
};

export function notRunText(reason: ReviewReason): string {
  const pill = REASON_PILLS[reason];
  const why = NOT_RUN_REASONS[reason] ?? `${pill.charAt(0).toLowerCase()}${pill.slice(1)}`;
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
  already_noted: "an earlier run’s test note is still on your team’s side",
  too_long: "the note would be too long",
  not_current: "the matchup is no longer ESPN’s current one",
  day_changed: "ESPN’s day changed",
  automation_off: "automation was turned off",
  not_allowlisted: "your team was unticked",
  earlier_write_on_espn: "an earlier try’s swap is on ESPN",
  pass_failed: "InjurySub kept failing on it",
};

// S15: where a run stopped and what it found there; null for a stop the run didn't make itself.
export function stopText(step: string | null, detail: string | null): string | null {
  if (step === null) return null;
  // FM-PROVING-1's own sentence, as the canvas draws it.
  if (step === "restore" && detail === "day_changed") {
    return "Stopped: the day changed on ESPN before the restore. Nothing more was sent.";
  }
  const where = Object.hasOwn(STOP_STEPS, step) ? STOP_STEPS[step] : step;
  const found =
    detail !== null && Object.hasOwn(STOP_DETAILS, detail) ? STOP_DETAILS[detail] : null;
  return found === null
    ? `Stopped at ${where}. Nothing more was sent.`
    : `Stopped at ${where}: ${found}. Nothing more was sent.`;
}

export type ProvingStepLine = {
  kind: "ok" | "waiting" | "fail" | "pending";
  title: string;
  detail: string;
  when: string;
};

const STEP_ORDER: ProvingWrite["step"][] = ["swap", "token", "revert", "restore"];

// FS-PROVING-4: a run's four steps in order, each from its latest write: on ESPN, being checked,
// stopped, not yet, or (a rehearsal) recorded and never sent.
export function runSteps(
  run: { injuredName: string; replacementName: string; writes: ProvingWrite[]; stopped: boolean },
  zone: string
): ProvingStepLine[] {
  const injured = surname(run.injuredName);
  const replacement = surname(run.replacementName);
  const words: Record<ProvingWrite["step"], [string, string]> = {
    swap: ["Swap", `${replacement} in for ${injured}, on your lineup today`],
    token: [
      "Test adjustment",
      "+0.1 on your matchup, reason \u201cInjurySub test (reverted)\u201d",
    ],
    revert: ["Revert the adjustment", "Back to your side\u2019s value before the test"],
    restore: ["Restore the lineup", `${injured} back, ${replacement} to the bench`],
  };
  let stopShown = false;
  return STEP_ORDER.map((step, index) => {
    const [name, detail] = words[step];
    const write = run.writes.filter((each) => each.step === step).at(-1);
    const state = stepState(write, run.stopped && !stopShown, zone);
    if (state.kind === "fail") stopShown = true;
    return { ...state, title: `${index + 1} · ${name}`, detail };
  });
}

function stepState(
  write: ProvingWrite | undefined,
  stopsHere: boolean,
  zone: string
): Pick<ProvingStepLine, "kind" | "when"> {
  if (write?.status === "recorded_only") return { kind: "pending", when: "Recorded, not sent" };
  if (write?.outcome === "verified") {
    return { kind: "ok", when: `On ESPN ${formatMoment(write.sentAt, zone, "weekday")}` };
  }
  if (write?.outcome === "not_applied" || write?.outcome === "ambiguous") {
    return { kind: "fail", when: "Stopped" };
  }
  if (stopsHere) return { kind: "fail", when: "Stopped" };
  if (write !== undefined) return { kind: "waiting", when: "Sent; checking ESPN\u2026" };
  return { kind: "pending", when: "Not yet" };
}

// FS-PROVING-3, -5: what the start form files, by how many runs have finished.
export function startTitle(finished: number): string {
  if (finished === 0) return "Request 1 of 2: a direct swap";
  if (finished === 1) return "Request 2 of 2: a one-move rearrangement";
  return "Another proving request";
}

// FM-PROVING-1: the moves to make on ESPN by hand to put your team back.
export function restoreMovesText(moves: NamedMove[]): string {
  const each = moves.map((move) => `${surname(move.name)} to ${slotLabel(move.toSlot)}`);
  const list =
    each.length <= 1 ? each.join("") : `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`;
  return `On ESPN, move ${list}.`;
}

// FM-PROVING-2: once proving is marked done, no more runs.
export function provingDoneText(doneAt: Date, zone: string): string {
  return `Proving is done (${formatMoment(doneAt, zone, "date")}), so further proving runs are refused.`;
}

export const BOTH_DONE = "Both proving requests ran end to end. Mark proving done in Settings.";

export const ACTIVITY_WARNING =
  "The test adjustment and its revert post on the league\u2019s ESPN activity feed, with the reason \u201cInjurySub test (reverted)\u201d. Everyone in the league can see them.";
