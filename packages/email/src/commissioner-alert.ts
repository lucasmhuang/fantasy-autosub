import {
  commissionerReasonFact,
  firstName,
  formatMoment,
  PACIFIC,
  REASON_PILLS,
  type ReviewReason,
  slotLabel,
  teamName,
} from "@injurysub/domain";
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

function owed(amount: AlertAmount): number | null {
  return amount.tenths === null || amount.tenths === 0 ? null : amount.tenths;
}

// The reason's one fact, shared with the queue and the detail (copy table 1, S2), or its pill
// where the pill says it all. A changed adjustment's two amounts are the Adjustment row's.
function reasonLine(
  situation: Extract<AlertSituation, { kind: "review" }>,
  input: CommissionerAlertInput
): string {
  const { reason } = situation;
  const sent = owed(input.amount);
  const fact =
    reason === "adjustment_changed"
      ? null
      : commissionerReasonFact(reason, {
          starter: surname(input.injuredName),
          week: situation.reason === "week_ended" ? situation.week : 0,
          moves:
            situation.reason === "rearrangement"
              ? situation.moves.map((move) => ({ name: surname(move.name), slot: move.toSlot }))
              : [],
          sent: sent === null ? null : emailAmount(sent),
          mismatch: situation.reason === "adjustment_held_rules" ? situation.rules : null,
          hours: situation.reason === "expired" ? situation.hours : 12,
        });
  return fact ?? `${REASON_PILLS[reason]}.`;
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

// The commissioner's alert, "{team} needs you" (FS-EMAIL-7 to -11), as one record.
export function commissionerAlertRecord(input: CommissionerAlertInput): EmailRecord {
  const team = teamName(input.teamId, input.teamName);
  const askedBy = firstName(input.askedBy);
  const asked = formatMoment(input.askedAt, PACIFIC, "date");
  const facts: EmailFact[] = [
    {
      label: "Swap",
      value: `${input.replacementName} in for ${input.injuredName} · ${slotLabel(input.slot)} slot`,
    },
    { label: "Asked", value: askedBy === null ? asked : `${asked}, by ${askedBy}` },
    adjustmentFact(input),
  ];
  const { situation } = input;
  if (situation.kind === "approval") {
    return {
      kind: "alert",
      subject: `${team} needs you`,
      lead: `A request from ${team} is waiting for your approval.`,
      facts: [
        ...facts,
        { label: "Expires", value: formatMoment(situation.expiresAt, PACIFIC, "weekday") },
      ],
    };
  }
  return {
    kind: "alert",
    subject: `${team} needs you`,
    lead: `A request from ${team} needs you. ${reasonLine(situation, input)}`,
    facts,
  };
}
