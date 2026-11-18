import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type StatusTone = "busy" | "wait" | "ok" | "neutral";

export type StatusPanelProps = {
  // busy: in line, in progress. wait: on the commissioner. ok: done. neutral: refused,
  // rejected, withdrawn, reversed.
  tone: StatusTone;
  word: string;
  // Who acts next, or "" where the state says it.
  who: string;
  sentence?: string;
  // While the request can still change, its changes are read out politely.
  live?: boolean;
  children?: ReactNode;
};

export function StatusPanel({
  tone,
  word,
  who,
  sentence,
  live = false,
  children,
}: StatusPanelProps) {
  return (
    <section
      className={`status is-${tone}`}
      aria-live={live ? "polite" : undefined}
      aria-label="Status"
    >
      <div className="status-head">
        <div className="t-status">{word}</div>
        {who && <span className="who">{who}</span>}
      </div>
      {sentence && <p>{sentence}</p>}
      {children}
    </section>
  );
}

export type TrackerStep = {
  label: string;
  state: "done" | "active" | "todo" | "held" | "skip";
  // A time without the weekday ("6:41 PM PT"), "sent 6:42 PM PT", "not owed", or a dash.
  note: string;
};

const MARKS: Record<TrackerStep["state"], ReactNode> = {
  done: <Icon name="check" size={12} strokeWidth={3} />,
  active: null,
  todo: null,
  held: "!",
  skip: "–",
};

// Checked, Lineup, Adjustment, Done, while InjurySub writes to ESPN. The green rail runs to the
// furthest step reached.
export function Tracker({ steps }: { steps: TrackerStep[] }) {
  const reached = steps.reduce(
    (furthest, step, index) => (["done", "active", "held"].includes(step.state) ? index : furthest),
    0
  );
  return (
    <div className="tracker" aria-label="Progress on ESPN">
      {reached > 0 && <div className="fill" style={{ width: `${25 * reached}%` }} />}
      {steps.map((step) => (
        <div key={step.label} className="step">
          <div className={`step-dot ${step.state}`}>{MARKS[step.state]}</div>
          <b>{step.label}</b>
          <span>{step.note}</span>
        </div>
      ))}
    </div>
  );
}

export type ReadBackLine = {
  // ok: ESPN shows it. waiting: sent, not yet seen. fail: refused or not sent. held: stopped for
  // the commissioner. pending: not sent yet.
  kind: "ok" | "waiting" | "fail" | "held" | "pending";
  text: ReactNode;
  when: string;
};

function ReadBackMark({ kind }: { kind: ReadBackLine["kind"] }) {
  if (kind === "waiting") return <span className="spin" aria-hidden="true" />;
  if (kind === "ok") return <Icon name="check" strokeWidth={2.6} className="text-ok" />;
  if (kind === "fail") return <Icon name="warn" className="text-out" />;
  if (kind === "held") return <Icon name="clock" className="text-wait" />;
  return <Icon name="dots" strokeWidth={2.6} className="text-text-meta" />;
}

// One line per ESPN write: what was sent, when, and what ESPN showed.
export function ReadBack({
  title,
  lines,
  id = "read-back",
}: {
  title: string;
  lines: ReadBackLine[];
  id?: string;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="t-label mb-(--space-4)">
        {title}
      </h2>
      {lines.map((line, index) => (
        <div key={`${index}-${line.when}`} className={cn("rb", line.kind === "fail" && "is-fail")}>
          <ReadBackMark kind={line.kind} />
          <span>
            {line.text}
            <span className="when">{line.when}</span>
          </span>
        </div>
      ))}
    </section>
  );
}
