import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { type Move, MoveList } from "./face-pair";
import { Icon } from "./icon";

export type HandStep = {
  // In ESPN's own words ("Adjustment on ESPN's Scoreboard").
  title: string;
  text?: string;
  // Read back from ESPN.
  done?: boolean;
  // A lineup step's moves, each with the player's face.
  moves?: Move[];
  // The exact value to type, in a copy field; `long` for the note. `action` is its Copy button.
  value?: { text: string; long?: boolean; action?: ReactNode };
};

export type ManualStepsProps = {
  steps: HandStep[];
  // When ESPN was read: the steps come from that read ("From ESPN Wed 6:44 PM PT").
  readAt: string;
  // Why a step is missing or can't be done as usual, before the steps.
  notes?: ReactNode;
  title?: string;
  id?: string;
};

function Step({ step, number }: { step: HandStep; number: number }) {
  return (
    <div className="hstep">
      <span className={cn("n", step.done && "done")}>
        {step.done ? <Icon name="check" size={12} strokeWidth={3} /> : number}
      </span>
      <div>
        <b>{step.title}</b>
        {step.text && <p>{step.text}</p>}
        {step.moves && <MoveList moves={step.moves} />}
        {step.value && (
          <div className="copyval">
            <code className={cn(step.value.long && "long")}>{step.value.text}</code>
            {step.value.action}
          </div>
        )}
      </div>
    </div>
  );
}

// What the commissioner does by hand on ESPN, numbered, each value ready to copy.
export function ManualSteps({
  steps,
  readAt,
  notes,
  title = "By hand on ESPN",
  id = "by-hand",
}: ManualStepsProps) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id} className="t-label">
          {title}
        </h2>
        <span className="state">{readAt}</span>
      </div>
      {notes && <div className="mt-(--space-6) flex flex-col gap-(--space-6)">{notes}</div>}
      <div className="steps mt-(--space-6)">
        {steps.map((step, index) => (
          <Step key={step.title} step={step} number={index + 1} />
        ))}
      </div>
    </section>
  );
}
