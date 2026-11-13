import { formatTenths } from "@injurysub/domain";
import type { ManualSteps } from "../../lib/server/commish";

const UNAVAILABLE_TEXT = {
  espn_unreachable: "ESPN can't be read right now, so the steps can't be worked out. Try again.",
  lineup_changed:
    "The team's lineup on ESPN no longer fits this swap as asked. Check it on ESPN before acting.",
  week_moved_on:
    "ESPN has moved past this request's matchup. Read the matchup's adjustment on ESPN before entering one.",
} as const;

// What's left to do by hand in ESPN's LM tools (Q5): the lineup moves, and the side's new
// adjustment, its existing one included.
export function ManualStepsPanel({ steps, matchupId }: { steps: ManualSteps; matchupId: number }) {
  if (steps.status === "not_needed") return null;
  return (
    <section className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
      <h3 className="text-base font-medium">By hand on ESPN</h3>
      {steps.status === "unavailable" ? (
        <p className="mt-2">{UNAVAILABLE_TEXT[steps.reason]}</p>
      ) : (
        <ReadySteps steps={steps} matchupId={matchupId} />
      )}
    </section>
  );
}

function ReadySteps(props: {
  steps: Extract<ManualSteps, { status: "ready" }>;
  matchupId: number;
}) {
  const { lineupMoves, adjustment } = props.steps;
  return (
    <div className="mt-2 flex flex-col gap-3">
      {lineupMoves.length === 0 ? (
        <p>The lineup is already done.</p>
      ) : (
        <ol className="grid list-decimal gap-1 pl-5">
          {lineupMoves.map((move) => (
            <li key={`${move.name}-${move.fromSlot}`}>
              {move.name}: {move.fromSlot} → {move.toSlot}
            </li>
          ))}
        </ol>
      )}
      {adjustment === null ? (
        <p>No adjustment to enter.</p>
      ) : (
        <div>
          <p>
            Matchup {props.matchupId}: set this team’s adjustment to{" "}
            <strong>{formatTenths(adjustment.enterTenths)}</strong> (now{" "}
            {formatTenths(adjustment.currentTenths)}).
          </p>
          <p className="mt-1 break-words">
            Reason:{" "}
            {adjustment.reason ?? "too long for the limit; shorten the existing reason first."}
          </p>
        </div>
      )}
    </div>
  );
}
