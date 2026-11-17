import { formatMoment, PACIFIC, type ReviewReason } from "@injurysub/domain";
import { type EmailFact, type EmailRecord, emailAmount, surname } from "./record";

// The amount an alert shows, and which amount it is (Revision 6 K): the filing's projection, the
// amount the worker computed (a held or refused adjustment), or the settled final or override.
export type AlertAmount = { tenths: number | null; kind: "projected" | "computed" | "settled" };

type ReasonWithFacts =
  | "rearrangement"
  | "adjustment_held_rules"
  | "adjustment_changed"
  | "expired"
  | "week_ended";

// Why the request needs the commissioner, with the facts the reason's sentence and panel name.
export type AlertSituation =
  | { kind: "approval"; expiresAt: Date }
  | {
      kind: "review";
      reason: "rearrangement";
      // The other starters the plan moves, each to the slot it takes.
      moves: readonly { name: string; toSlot: string }[];
    }
  | {
      kind: "review";
      reason: "adjustment_held_rules";
      // The first rule that differed, worded as the request's page words it, and how many more.
      rules: { first: string; more: number } | null;
    }
  | { kind: "review"; reason: "adjustment_changed"; nowTenths: number; thenTenths: number | null }
  | { kind: "review"; reason: "expired"; hours: number }
  | { kind: "review"; reason: "week_ended"; week: number }
  | { kind: "review"; reason: Exclude<ReviewReason, ReasonWithFacts> };

export type CommissionerAlertInput = {
  to: string;
  requestId: string;
  // The request's version after the change the email is about.
  version: number;
  teamId: number;
  // ESPN's team name from the filing, or null when none was stored.
  teamName: string | null;
  injuredName: string;
  replacementName: string;
  slot: string;
  askedAt: Date;
  // The team's manager, whoever filed; null when the team has no active account.
  askedBy: string | null;
  amount: AlertAmount;
  situation: AlertSituation;
};

const APPROVE = "Approve it, settle it by hand or reject it in InjurySub’s queue.";
const REAPPROVE = "Re-approve it, settle it by hand or reject it in InjurySub’s queue.";
const HAND = "Settle it by hand or reject it in InjurySub’s queue.";
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

const FOOT = [
  "Sent to you as the league’s commissioner on InjurySub.",
  "Not affiliated with ESPN or the NBA.",
];

type Wording = { clause: string; fact?: EmailFact; body?: string; action: string };

function owed(amount: AlertAmount): number | null {
  return amount.tenths === null || amount.tenths === 0 ? null : amount.tenths;
}

// "Approving re-checks ESPN, then makes the swap and posts −31.0." (FS-EMAIL-11; Revision 6 L).
function approvingSentence(amount: AlertAmount): string {
  const tenths = owed(amount);
  return tenths === null
    ? "Approving re-checks ESPN, then makes the swap."
    : `Approving re-checks ESPN, then makes the swap and posts ${emailAmount(tenths)}.`;
}

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

// The reasons whose sentence needs no fact beyond the request's own.
const PLAIN_WORDINGS: Record<
  Exclude<ReviewReason, ReasonWithFacts>,
  (input: CommissionerAlertInput, team: string) => Wording
> = {
  automation_off: () => ({ clause: "automation is off.", action: HAND }),
  not_allowlisted: (_input, team) => ({
    clause: `${team} isn’t ticked for automation.`,
    action: HAND,
  }),
  suspension: (input) => ({
    clause: `${surname(input.injuredName)} is suspended, not OUT.`,
    body: `Suspensions don’t qualify on their own; you decide each one. ${approvingSentence(input.amount)}`,
    action: APPROVE,
  }),
  stale: () => ({
    clause: "the lineup changed on ESPN after the request, so nothing was sent.",
    action: APPROVE,
  }),
  ambiguous: () => ({
    clause: "ESPN’s lineup didn’t match after the change.",
    action: "Check the lineup on ESPN, then settle it by hand in InjurySub’s queue.",
  }),
  lineup_failed: () => ({
    clause: "ESPN refused the lineup change, and nothing else was sent.",
    action: HAND,
  }),
  adjustment_failed: (input) => {
    const tenths = owed(input.amount);
    const adjustment = tenths === null ? "adjustment" : `${emailAmount(tenths)} adjustment`;
    return {
      clause: `the lineup is done, but ESPN refused the ${adjustment}.`,
      action: "Post the adjustment by hand in InjurySub’s queue.",
    };
  },
  playoffs: () => ({ clause: "playoff weeks always come to you.", action: HAND }),
};

// FS-EMAIL-10: each reason's clause, its own fact, any paragraph and its closing line.
function reviewWording(
  situation: Extract<AlertSituation, { kind: "review" }>,
  input: CommissionerAlertInput,
  team: string
): Wording {
  switch (situation.reason) {
    case "rearrangement":
      return {
        clause: `${countWord(situation.moves.length)} other starters would have to move.`,
        fact: {
          label: "Moves",
          value: situation.moves
            .map((move) => `${surname(move.name)} to ${slotLabel(move.toSlot)}`)
            .join(", "),
        },
        action: HAND,
      };
    case "adjustment_held_rules": {
      const { rules } = situation;
      const more = rules === null || rules.more === 0 ? "" : `; and ${rules.more} more`;
      return {
        clause: "the league’s ESPN rules differ from InjurySub’s, so the adjustment is held.",
        ...(rules === null ? {} : { fact: { label: "Rules", value: `${rules.first}${more}` } }),
        action: REAPPROVE,
      };
    }
    case "adjustment_changed":
      return { clause: "the adjustment changed after you approved it.", action: REAPPROVE };
    case "expired":
      return {
        clause: `it waited ${situation.hours} hours without running.`,
        body: `Approving it now re-checks ESPN first and restarts the ${situation.hours} hours.`,
        action: APPROVE,
      };
    case "week_ended":
      return {
        clause: `week ${situation.week} ended before it ran.`,
        body: `Week ${situation.week}’s lineup can’t change now, so only the adjustment is left to post.`,
        action: "Post the adjustment by hand, or reject it, in InjurySub’s queue.",
      };
    default:
      return PLAIN_WORDINGS[situation.reason](input, team);
  }
}

// "Adjustment" in the panel (FS-EMAIL-7, Revision 6 K and L).
function adjustmentFact(input: CommissionerAlertInput): EmailFact {
  const { situation, amount } = input;
  if (situation.kind === "review" && situation.reason === "adjustment_changed") {
    const then =
      situation.thenTenths === null ? "" : `, ${emailAmount(situation.thenTenths)} when approved`;
    return { label: "Adjustment", value: `${emailAmount(situation.nowTenths)} now${then}` };
  }
  const tenths = owed(amount);
  if (tenths === null) return { label: "Adjustment", value: "None" };
  const askedOnly =
    situation.kind === "review" &&
    (situation.reason === "expired" || situation.reason === "week_ended");
  const meta =
    amount.kind === "settled"
      ? undefined
      : amount.kind === "computed"
        ? "computed"
        : askedOnly
          ? "projected when asked"
          : "projected";
  return {
    label: "Adjustment",
    value: emailAmount(tenths),
    ...(meta === undefined ? {} : { meta }),
    ...(tenths < 0 ? { tone: "out" as const } : {}),
  };
}

function slotLabel(slot: string): string {
  return slot === "BE" ? "BN" : slot;
}

// The commissioner's alert, "{team} needs you" (FS-EMAIL-7 to -11), as one record.
export function commissionerAlertRecord(input: CommissionerAlertInput): EmailRecord {
  const team = input.teamName ?? `Team ${input.teamId}`;
  const asked = formatMoment(input.askedAt, PACIFIC, "date");
  const facts: EmailFact[] = [
    {
      label: "Swap",
      value: `${input.replacementName} in for ${input.injuredName} · ${slotLabel(input.slot)} slot`,
    },
    { label: "Asked", value: input.askedBy === null ? asked : `${asked}, by ${input.askedBy}` },
    adjustmentFact(input),
  ];
  const { situation } = input;
  if (situation.kind === "approval") {
    const deadline = formatMoment(situation.expiresAt, PACIFIC, "weekday");
    return {
      kind: "alert",
      subject: `${team} needs you`,
      lead: `A request from ${team} is waiting for your approval.`,
      facts,
      body: [
        `${approvingSentence(input.amount)} If it isn’t approved by ${deadline}, it expires and stays in your queue.`,
      ],
      action: APPROVE,
      foot: FOOT,
    };
  }
  const wording = reviewWording(situation, input, team);
  return {
    kind: "alert",
    subject: `${team} needs you`,
    lead: `A request from ${team} needs you: ${wording.clause}`,
    facts: wording.fact === undefined ? facts : [...facts, wording.fact],
    ...(wording.body === undefined ? {} : { body: [wording.body] }),
    action: wording.action,
    foot: FOOT,
  };
}
