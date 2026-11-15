import { cn } from "../lib/cn";
import { type FaceImage, PlayerFace } from "./player-face";
import { StatusPill } from "./status-pill";
import { teamStyle } from "./team";

export type BoardRowProps = {
  slot: string;
  name: string;
  team?: string | null;
  // The team's logo, faint behind the slot label; none for a free agent.
  logo?: string | null;
  face?: FaceImage | null;
  // Team · next game or game state ("GS · 7:00 PM PT vs SAC", "Live, Q3 @ CHA").
  meta: string;
  // Only while the scoreboard says the game is on.
  live?: boolean;
  dayToDay?: boolean;
  // A bench player designated OUT or suspended, said in his meta line.
  pill?: "out" | "suspended";
  bench?: boolean;
  weekPoints: string;
  average: string;
};

function RowMeta({
  meta,
  live,
  dayToDay,
  pill,
}: Pick<BoardRowProps, "meta" | "live" | "dayToDay" | "pill">) {
  return (
    <div className="row-meta">
      {pill === "out" && (
        <StatusPill kind="out" small>
          OUT
        </StatusPill>
      )}
      {pill === "suspended" && (
        <StatusPill kind="suspended" small>
          Suspended
        </StatusPill>
      )}
      {live && <span className="live" aria-label="Live" />}
      <span>{dayToDay ? `Day-to-day · ${meta}` : meta}</span>
    </div>
  );
}

// One player in the board's list, in ESPN's slot order. Not a link: the OUT card's button acts.
export function BoardRow({
  slot,
  name,
  team,
  logo,
  face,
  bench = false,
  weekPoints,
  average,
  ...meta
}: BoardRowProps) {
  return (
    <div className={cn("row", bench && "is-bench")} style={teamStyle(team)}>
      <div className="row-slot">
        {logo && <img className="row-logo" src={logo} alt="" />}
        {slot}
      </div>
      <div className="row-face">
        <PlayerFace image={face} />
      </div>
      <div className="min-w-0">
        <div className="row-name ellipsis">{name}</div>
        <RowMeta {...meta} />
      </div>
      <div>
        <div className="row-pts">{weekPoints}</div>
        <div className="row-avg">avg {average}</div>
      </div>
    </div>
  );
}

export type BoardRowGapProps = {
  slot: string;
  name: string;
  weekPoints: string;
  suspended?: boolean;
};

// The OUT (or suspended) starter's place in the list, while his card sits above it.
export function BoardRowGap({ slot, name, weekPoints, suspended = false }: BoardRowGapProps) {
  return (
    <div className={cn("row-gap", suspended && "is-susp")}>
      <div className="row-slot">{slot}</div>
      <div className="min-w-0">
        <div className="row-name ellipsis">{name}</div>
        <div className="row-meta">{suspended ? "Suspended" : "OUT"}</div>
      </div>
      <div className="row-pts">{weekPoints}</div>
    </div>
  );
}
