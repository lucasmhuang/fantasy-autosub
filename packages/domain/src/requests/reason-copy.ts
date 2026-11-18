import { slotLabel } from "../names/display-names";
import type { ReviewReason } from "./lifecycle";

// One source for why a request is with the commissioner (copy table 1, S2): the queue's pill, the
// commissioner's one fact (queue row, request detail, alert email) and the manager's sentence.
// Callers pass names, times and amounts already formatted for their reader.

export const REASON_PILLS: Record<ReviewReason, string> = {
  automation_off: "Automation off",
  not_allowlisted: "Not ticked",
  rearrangement: "Rearrangement",
  suspension: "Suspension",
  stale: "Lineup changed",
  ambiguous: "Check ESPN",
  lineup_failed: "Lineup failed",
  adjustment_failed: "Adjustment failed",
  adjustment_held_rules: "Adjustment held",
  adjustment_changed: "Adjustment changed",
  expired: "Expired",
  week_ended: "Week ended",
  playoffs: "Playoffs",
};

export type ReasonFacts = {
  // The injured starter's surname.
  starter: string;
  week: number;
  // The other starters a rearrangement moves, each to the slot it takes.
  moves?: readonly { name: string; slot: string }[];
  // When ESPN refused the lineup change.
  at?: string | null;
  // The adjustment ESPN refused, and a changed one's amount when approved and now.
  sent?: string | null;
  approved?: string | null;
  held?: string | null;
  // The first rule that differed, in `ruleMismatchWords`' words, and how many more.
  mismatch?: { first: string; more: number } | null;
  hours?: number;
  filed?: string | null;
};

// A rule the league's ESPN settings break, one way everywhere.
export type RuleMismatchFacts =
  | { kind: "setting"; setting: string; espn: string; expected: string }
  | { kind: "day-points"; name: string; espnPoints: number; formulaPoints: number };

export function ruleMismatchWords(mismatch: RuleMismatchFacts): string {
  return mismatch.kind === "setting"
    ? `${mismatch.setting} is ${mismatch.espn} on ESPN; InjurySub expects ${mismatch.expected}`
    : `${mismatch.name} scored ${mismatch.espnPoints} on ESPN; InjurySub's formula gives ${mismatch.formulaPoints}`;
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

function movesSentence(moves: readonly { name: string; slot: string }[]): string {
  if (moves.length === 0) return "Other starters would move.";
  const count = COUNT_WORDS[moves.length] ?? String(moves.length);
  const list = moves.map(({ name, slot }) => `${name} to ${slotLabel(slot)}`).join(", ");
  return `${count} other starters would move: ${list}.`;
}

function heldSentence(mismatch: ReasonFacts["mismatch"]): string {
  if (mismatch === null || mismatch === undefined) return "Lineup done. League rules differ.";
  const more = mismatch.more > 0 ? `; and ${mismatch.more} more` : "";
  return `Lineup done. ${mismatch.first}${more}.`;
}

// The commissioner's fact for a reason, or null where the pill says it all.
export function commissionerReasonFact(reason: ReviewReason, facts: ReasonFacts): string | null {
  switch (reason) {
    case "automation_off":
    case "not_allowlisted":
    case "playoffs":
      return null;
    case "rearrangement":
      return movesSentence(facts.moves ?? []);
    case "suspension":
      return `${facts.starter} is suspended, not OUT.`;
    case "stale":
      return "Lineup changed on ESPN after the request; nothing was sent.";
    case "ambiguous":
      return "ESPN's lineup didn't match after the change; no adjustment was posted.";
    case "lineup_failed":
      return facts.at
        ? `ESPN refused the lineup change at ${facts.at}; nothing else was sent.`
        : "ESPN refused the lineup change; nothing else was sent.";
    case "adjustment_failed":
      return facts.sent
        ? `Lineup done; ESPN refused the ${facts.sent} adjustment.`
        : "Lineup done; ESPN refused the adjustment.";
    case "adjustment_held_rules":
      return heldSentence(facts.mismatch);
    case "adjustment_changed":
      return facts.approved && facts.held
        ? `${facts.approved} when you approved, ${facts.held} now.`
        : null;
    case "expired": {
      const filed = facts.filed ? `; filed ${facts.filed}` : "";
      return `Waited ${facts.hours ?? 12} hours${filed}.`;
    }
    case "week_ended":
      return `Week ${facts.week} ended before it ran.`;
  }
}

// The manager's sentence for why the request is with the commissioner; the panel's word already
// says it waits for them.
export function managerReasonSentence(
  reason: ReviewReason,
  words: { commissioner: string; starter: string; week: number }
): string {
  const { commissioner: c, starter, week } = words;
  switch (reason) {
    case "automation_off":
      return `${c} settles requests by hand for now.`;
    case "not_allowlisted":
      return `${c} settles your team's requests by hand for now.`;
    case "rearrangement":
      return `Other starters would have to move, so ${c} settles it by hand.`;
    case "suspension":
      return `${starter} is suspended, not OUT, so ${c} decides.`;
    case "stale":
      return "Your ESPN lineup changed after you asked, so nothing was sent.";
    case "ambiguous":
      return "ESPN's lineup didn't match after the change; no adjustment was posted.";
    case "lineup_failed":
      return "ESPN refused the lineup change, so nothing changed.";
    case "adjustment_failed":
      return "Your lineup is done on ESPN; ESPN refused the adjustment.";
    case "adjustment_held_rules":
      return "Your lineup is done on ESPN. The league's ESPN settings differ from InjurySub's, so the adjustment is held.";
    case "adjustment_changed":
      return `Your lineup is done. The adjustment changed after ${c} approved it.`;
    case "expired":
      return "It waited 12 hours without running.";
    case "week_ended":
      return `Week ${week} ended before it ran.`;
    case "playoffs":
      return `In playoff weeks ${c} settles every request.`;
  }
}
