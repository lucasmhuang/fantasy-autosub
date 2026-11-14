import { randomUUID } from "node:crypto";
import { Button } from "@injurysub/ui";
import type { NamedMove, ProvingChoices, ProvingOption } from "../../lib/server/proving";
import { NO_BOARD_TEXT } from "../requests/labels";

const inputClassName =
  "rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]";
const cardClassName = "flex flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-black/15 p-4";

const OPTION_KIND_LABELS: Record<ProvingOption["kind"], string> = {
  direct_swap: "Direct swap",
  one_move: "One-move rearrangement",
};

// S18: what can be filed for team 1, until proving is marked done.
export function ProvingChoicesPanel({ choices }: { choices: ProvingChoices }) {
  if (choices.status === "no_matchup") return <Muted text="Team 1 has no matchup this week." />;
  if (choices.status !== "found") return <Muted text={NO_BOARD_TEXT[choices.status]} />;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <StarterPicker choices={choices} />
      {choices.chosen === null ? null : <OptionList choices={choices} />}
      <MarkDoneForm />
    </div>
  );
}

function StarterPicker({ choices }: { choices: Extract<ProvingChoices, { status: "found" }> }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span>Starter to swap out</span>
        <select name="starter" defaultValue={choices.chosen ?? ""} className={inputClassName}>
          {choices.starters.map((starter) => (
            <option key={starter.playerId} value={starter.playerId}>
              {starter.name} ({starter.slot})
            </option>
          ))}
        </select>
      </label>
      <Button intent="ghost" size="sm" type="submit">
        Show options
      </Button>
    </form>
  );
}

function OptionList({ choices }: { choices: Extract<ProvingChoices, { status: "found" }> }) {
  if (choices.options.length === 0) {
    return (
      <Muted text="No bench player can come in for him with at most one other starter moving." />
    );
  }
  return (
    <ul className="grid gap-3">
      {choices.options.map((option) => (
        <li key={option.playerId}>
          <OptionForm option={option} injured={choices.chosen} period={choices.period} />
        </li>
      ))}
    </ul>
  );
}

// Each option files itself with the edit and matchup period shown, as Confirm does (R4).
function OptionForm(props: { option: ProvingOption; injured: number | null; period: number }) {
  const { option } = props;
  return (
    <form action="/commish/proving/file" method="post" className={cardClassName}>
      <input type="hidden" name="injured" value={props.injured ?? ""} />
      <input type="hidden" name="replacement" value={option.playerId} />
      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
      <input type="hidden" name="edit" value={option.digest} />
      <input type="hidden" name="period" value={props.period} />
      <span className="text-base font-medium">
        {option.name} · {OPTION_KIND_LABELS[option.kind]}
      </span>
      <MoveList moves={option.moves} />
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        File a proving request
      </Button>
    </form>
  );
}

export function MoveList({ moves }: { moves: NamedMove[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {moves.map((move) => (
        <li key={`${move.name}:${move.fromSlot}`}>
          {move.name}: {move.fromSlot} → {move.toSlot}
        </li>
      ))}
    </ol>
  );
}

function MarkDoneForm() {
  return (
    <form action="/commish/proving/done" method="post" className={cardClassName}>
      <span>
        Mark proving done: no more proving requests can be filed, and this page can’t undo it.
      </span>
      <Button intent="ghost" size="sm" type="submit" className="self-start">
        Mark proving done
      </Button>
    </form>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="text-sm text-[color:var(--muted)]">{text}</p>;
}
