import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { type FaceImage, PlayerFace } from "./player-face";
import { teamStyle } from "./team";

// Status finishes: OUT and suspended carry a stamp in the corner; benched is the outgoing card
// once the swap is done.
const FINISHES = {
  out: { className: "is-out", stamp: "OUT" },
  suspended: { className: "is-susp", stamp: "SUSP" },
  benched: { className: "is-benched", stamp: null },
} as const;

export type PlayerCardProps = {
  // m: Confirm. s: the incoming card on the stage. xs: the outgoing card behind it.
  size: "m" | "s" | "xs";
  surname: string;
  team?: string | null;
  logo?: string | null;
  face?: FaceImage | null;
  // The headline: the season average, or the points a swap forfeits.
  number?: string;
  // m only: "Season avg" or "Forfeits".
  numberLabel?: string;
  // m only, under the surname: slot · team · one fact ("C · MIN · 3 games left").
  fact?: string;
  finish?: keyof typeof FINISHES;
  // s and xs: the bar's words ("Reid · C", "To bench", "Bench").
  band?: string;
  // Once, across the incoming card, when ESPN confirms while the page is open.
  sheen?: boolean;
};

function Corner({ size, finish, logo }: Pick<PlayerCardProps, "size" | "finish" | "logo">) {
  if (size === "xs") return null;
  const stamp = finish ? FINISHES[finish].stamp : null;
  if (stamp) return <div className="stamp">{stamp}</div>;
  return logo ? <img className="corner" src={logo} alt="" /> : null;
}

// The outgoing card behind the stage carries no headline number.
function Headline({
  size,
  number,
  numberLabel,
}: Pick<PlayerCardProps, "size" | "number" | "numberLabel">) {
  if (!number || size === "xs") return null;
  if (size !== "m") {
    return (
      <div className="num-tl">
        <div className="t-card-s">{number}</div>
      </div>
    );
  }
  return (
    <div className="num-tl">
      <div className="t-card-m">{number}</div>
      <div className="t-micro">{numberLabel}</div>
    </div>
  );
}

function Bar({
  size,
  surname,
  fact,
  finish,
  band,
}: Pick<PlayerCardProps, "size" | "surname" | "fact" | "finish" | "band">) {
  if (size === "m") {
    return (
      <div className="bar">
        <div className="t-name-bar">{surname}</div>
        <div className="sub">{fact}</div>
      </div>
    );
  }
  return <div className={cn("bar", finish === "out" && "band-out")}>{band ?? surname}</div>;
}

// The portrait trading card. One anatomy everywhere; only the size, the finish and the corner
// change.
export function PlayerCard({ size, team, face, finish, sheen = false, ...parts }: PlayerCardProps) {
  return (
    <div
      className={cn("pcard", `pcard-${size}`, finish && FINISHES[finish].className)}
      style={teamStyle(team)}
    >
      <PlayerFace image={face} className="hs" />
      <Corner size={size} finish={finish} logo={parts.logo} />
      <Headline size={size} number={parts.number} numberLabel={parts.numberLabel} />
      <Bar
        size={size}
        surname={parts.surname}
        fact={parts.fact}
        finish={finish}
        band={parts.band}
      />
      {sheen && <div className="sheen play" />}
    </div>
  );
}

export type FoilProps = {
  // Unlit until ESPN confirms the swap.
  confirmed: boolean;
  // The card on the request page's stage.
  onStage?: boolean;
  children: ReactNode;
};

// The incoming replacement's ring, drawn inside the card's edge. Foil means only that this
// player is coming in.
export function Foil({ confirmed, onStage = false, children }: FoilProps) {
  return (
    <div className={cn("foil", onStage && "on-stage", !confirmed && "is-unlit")}>{children}</div>
  );
}
