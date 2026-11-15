import type { ReactNode } from "react";

// ok: working. bad: failing. warn: needs attention. off: not connected or not checked. The marks
// differ in shape as well as colour; the state word carries the meaning.
export type HealthCheck = {
  // "ESPN", "Swap runner", "League rules", "Misuse watch".
  name: string;
  mark: "ok" | "bad" | "warn" | "off";
  // "Working", "Access refused", "Running", "2 differ".
  state: string;
  when?: string;
  // What to do, or each mismatch.
  detail?: ReactNode;
};

function HealthRow({ name, mark, state, when, detail }: HealthCheck) {
  return (
    <div className={`hrow ${mark}`}>
      <span className="mark" aria-hidden="true" />
      <span>{name}</span>
      <span className="state">
        <b>{state}</b>
        {when && ` · ${when}`}
      </span>
      {detail && <div className="detail">{detail}</div>}
    </div>
  );
}

export type HealthPanelProps = {
  checks: HealthCheck[];
  // The latest check, for the one line shown while everything works.
  summaryWhen: string;
  id?: string;
};

// The first thing on the queue. One line while everything works; every check its own row once
// one is in trouble, the swap runner apart from ESPN.
export function HealthPanel({ checks, summaryWhen, id = "health" }: HealthPanelProps) {
  const allWell = checks.every(({ mark }) => mark === "ok");
  return (
    <section className="health" aria-labelledby={id}>
      <h2 id={id} className="t-label">
        Health
      </h2>
      {allWell ? (
        <HealthRow name="ESPN, swap runner and rules" mark="ok" state="OK" when={summaryWhen} />
      ) : (
        checks.map((check) => <HealthRow key={check.name} {...check} />)
      )}
    </section>
  );
}
