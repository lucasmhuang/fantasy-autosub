import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Where each line comes from, in words: to the manager who asked, or about the request.
const KINDS = {
  start: "Forfeited while starting",
  credit: "Earlier credit given back",
  after: "After you asked",
  bench: "On the bench, after you asked",
  before: "Before you asked: doesn't count",
} as const;

const COMMISSIONER_KINDS: Record<keyof typeof KINDS, string> = {
  ...KINDS,
  after: "After the request",
  bench: "On the bench, after the request",
  before: "Before the request: doesn't count",
};

export type AdjustmentReader = "manager" | "commissioner";

export type AdjustmentLine = {
  // "Embiid · Mon Nov 9".
  who: string;
  // Signed, one decimal ("−46.5", "+17.7", "0.0").
  amount: string;
} & (
  | { kind: keyof typeof KINDS; note?: never }
  // A line no kind fits, in its own words ("Cancels the −87.8 adjustment").
  | { kind?: never; note: string }
);

export type AdjustmentPanelProps = {
  // Signed; null when nothing is owed.
  total: string | null;
  // Projected until ESPN shows the day the swap took effect.
  state: "Projected" | "Final";
  lines: AdjustmentLine[];
  // The week strip, and its one-line key when shown.
  strip?: ReactNode;
  // Above the total: why the commissioner enters it, when the league's rules differ.
  notice?: ReactNode;
  // What happens from here; when nothing is owed, why.
  foot?: string;
  title?: string;
  id?: string;
  // Who reads the lines' words; the manager by default.
  reader?: AdjustmentReader;
};

// Negative with either minus: the typographic one, or the hyphen domain's formatTenths writes.
function signTone(amount: string): "neg" | "pos" | "zero" {
  if (/^[-−]/.test(amount)) return "neg";
  return amount.startsWith("+") ? "pos" : "zero";
}

function Line({ who, amount, kind, note, reader }: AdjustmentLine & { reader: AdjustmentReader }) {
  const words = reader === "commissioner" ? COMMISSIONER_KINDS : KINDS;
  return (
    <div className="adj-line">
      <div className="who">{who}</div>
      <div className={cn("amt", signTone(amount))}>{amount}</div>
      <div className="kind">{kind === undefined ? note : words[kind]}</div>
    </div>
  );
}

// The adjustment a swap owes. Every line stays in the panel; it grows rather than scroll.
export function AdjustmentPanel({
  total,
  state,
  lines,
  strip,
  notice,
  foot,
  title = "Adjustment",
  id = "adjustment",
  reader = "manager",
}: AdjustmentPanelProps) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id} className="t-label">
          {title}
        </h2>
        <span className={cn("state", state === "Final" && "final")}>{state}</span>
      </div>
      {notice}
      {total === null ? (
        <p className="t-amount mt-(--space-8) leading-[1.2]">No adjustment</p>
      ) : (
        <div className={cn("t-total adj-total", total.startsWith("+") && "pos")}>{total}</div>
      )}
      {strip}
      {lines.map((line, index) => (
        <Line key={`${index}-${line.who}`} {...line} reader={reader} />
      ))}
      {foot && <p className="foot">{foot}</p>}
    </section>
  );
}
