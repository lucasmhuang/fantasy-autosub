import { Button } from "@injurysub/ui";
import Link from "next/link";
import type { BoardOption } from "../../lib/server/board";
import { formatNextGame } from "./format";
import {
  OPTION_REASON_TEXT,
  OPTION_STATUS_COLORS,
  OPTION_STATUS_LABELS,
  OPTION_WARNING_TEXT,
} from "./labels";
import { LineupPreview } from "./lineup-preview";

// One bench player as a replacement for the chosen starter.
export function OptionRow({ option, injuredId }: { option: BoardOption; injuredId: number }) {
  const average = option.seasonAveragePoints;
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-medium">{option.name}</h4>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {option.proTeam} · {option.position} · {option.gamesLeft} games left · avg{" "}
            {average === null ? "n/a" : average.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            Next: {formatNextGame(option.nextGame)}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-3 py-1 text-xs"
          style={OPTION_STATUS_COLORS[option.status]}
        >
          {OPTION_STATUS_LABELS[option.status]}
        </span>
      </div>
      {option.reason === null ? null : (
        <p className="mt-3 text-sm">{OPTION_REASON_TEXT[option.reason]}</p>
      )}
      {option.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-sm text-[color:var(--warning)]">
          {OPTION_WARNING_TEXT[warning]}
        </p>
      ))}
      {option.lineup === null ? null : <LineupPreview lineup={option.lineup} />}
      <OptionChoice option={option} injuredId={injuredId} />
    </div>
  );
}

function OptionChoice({ option, injuredId }: { option: BoardOption; injuredId: number }) {
  if (option.status === "not_valid") return null;
  const href = `/app/requests/new?injured=${injuredId}&replacement=${option.playerId}`;
  return (
    <div className="mt-4">
      {/* Ghost: the step's one primary action is Confirm (behaviors D16). */}
      <Button asChild intent="ghost" size="sm">
        <Link href={href}>Choose {option.name}</Link>
      </Button>
    </div>
  );
}
