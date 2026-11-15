import type { ReactNode } from "react";
import { type Move, MoveList } from "./face-pair";

export type AlertRowProps = {
  // "Lineup change on Stretch Fours".
  title: string;
  // ESPN's time and when InjurySub saw it.
  when: string;
  // The change in a sentence.
  what: string;
  moves?: Move[];
  // "To undo: …".
  undo?: ReactNode;
  // Acknowledge, or when it was acknowledged.
  action: ReactNode;
};

// A change on ESPN that InjurySub didn't make, how to undo it, and Acknowledge.
export function AlertRow({ title, when, what, moves, undo, action }: AlertRowProps) {
  return (
    <div className="qrow alert-row">
      <div className="row-between flex justify-between gap-(--space-12)">
        <div className="min-w-0">
          <div className="team">{title}</div>
          <div className="when">{when}</div>
        </div>
        {action}
      </div>
      <p className="what">{what}</p>
      {moves && moves.length > 0 && <MoveList moves={moves} />}
      {undo && <p className="undo">{undo}</p>}
    </div>
  );
}
