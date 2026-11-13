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
// Dec-D29b: ESPN's lineup moved since Confirm, so the edit above (the one the app would send)
// differs from the one the manager confirmed.
function ConfirmedMoves({ moves }: { moves: NonNullable<Ready["confirmedMoves"]> }) {
  return (
    <div className="text-[color:var(--muted)]">
      <p>The manager confirmed a different change, before ESPN’s lineup moved:</p>
      <ol className="mt-1 grid list-decimal gap-1 pl-5">
        {moves.map((move) => (
          <li key={`${move.name}-${move.fromSlot}`}>
            {move.name}: {move.fromSlot} → {move.toSlot}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ManualStepsPanel({ steps }: { steps: ManualSteps }) {
  if (steps.status === "not_needed") return null;
  return (
    <section className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
      <h3 className="text-base font-medium">By hand on ESPN</h3>
      {steps.status === "unavailable" ? (
        <p className="mt-2">{UNAVAILABLE_TEXT[steps.reason]}</p>
      ) : (
        <ReadySteps steps={steps} />
      )}
    </section>
  );
}

type Ready = Extract<ManualSteps, { status: "ready" }>;

function ReadySteps(props: { steps: Ready }) {
  const { lineupMoves, confirmedMoves, adjustment } = props.steps;
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
      {confirmedMoves === null ? null : <ConfirmedMoves moves={confirmedMoves} />}
      {adjustment === null ? (
        <p>No adjustment to enter.</p>
      ) : (
        <div>
          <p>
            On ESPN’s Scoreboard, open <strong>Matchup {adjustment.matchupPeriodId}</strong>, then{" "}
            <strong>Adjust Scoring</strong> on {adjustment.teamName}’s pairing. Set{" "}
            {adjustment.teamName}’s adjustment to{" "}
            <strong>{formatTenths(adjustment.enterTenths)}</strong> (now{" "}
            {formatTenths(adjustment.currentTenths)}).
          </p>
          <p className="mt-1 break-words">
            Note:{" "}
            {adjustment.reason ?? "too long for the limit; shorten the existing reason first."}
          </p>
        </div>
      )}
    </div>
  );
}
