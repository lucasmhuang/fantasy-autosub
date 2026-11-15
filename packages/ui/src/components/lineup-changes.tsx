import { cn } from "../lib/cn";
import { SmallFace, type SmallFaceProps } from "./face-pair";

export type LineupChange = SmallFaceProps & {
  // The slot he ends in.
  slot: string;
  // He ends on the bench: the slot in the OUT tones.
  bench?: boolean;
  name: string;
  // "Moves from F/C. His points count either way.", "Comes off the bench.", "Goes to the bench."
  text: string;
};

export type LineupChangesProps = {
  changes: LineupChange[];
  // "Your lineup changes" on Confirm; "Approving sends" for the commissioner.
  title?: string;
  // "One edit on ESPN".
  aside?: string;
  id?: string;
};

// Every lineup change a swap makes, so a swap that moves another starter shows before the tap:
// the starter who moves, the replacement, then the injured starter to the bench.
export function LineupChanges({
  changes,
  title = "Your lineup changes",
  aside,
  id = "lineup-changes",
}: LineupChangesProps) {
  return (
    <section className="panel px-(--space-16) pt-(--space-14) pb-(--space-6)" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id} className="t-label">
          {title}
        </h2>
        {aside && <span className="state">{aside}</span>}
      </div>
      <div className="mt-(--space-6)">
        {changes.map(({ slot, bench = false, name, text, ...face }) => (
          <div key={`${slot}-${name}`} className="lchange">
            <span className={cn("slot-chip", bench && "is-bench")}>{slot}</span>
            <SmallFace {...face} />
            <div className="min-w-0">
              <div className="ellipsis font-semibold text-[14px]">{name}</div>
              <div className="mt-(--space-2) text-[12px] text-text-meta">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
