import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { type FaceImage, PlayerFace } from "./player-face";
import { teamStyle } from "./team";

// An option card keeps the full name on one line: at 16 px if it fits, else 14 px, else the
// initial and surname. Measured on every rostered player at 390 px (the name line is 150 px):
// every name up to 16 characters fits at 16 px, and up to 20 at 14 px. The ellipsis remains
// for the rare name wider than its count suggests.
const FITS_AT_16 = 16;
const FITS_AT_14 = 20;

export function optionName(name: string): { text: string; step: boolean } {
  if (name.length <= FITS_AT_16) return { text: name, step: false };
  if (name.length <= FITS_AT_14) return { text: name, step: true };
  const [first = "", ...rest] = name.split(" ");
  const short = `${first.slice(0, 1)}. ${rest.join(" ")}`;
  return { text: short, step: short.length > FITS_AT_16 };
}

export type OptionCardProps = {
  name: string;
  team?: string | null;
  positions: string;
  face?: FaceImage | null;
  average: string;
  gamesLeft: string;
  // The game days ("Wed, Fri, Sun").
  gameDays: string;
  // Opponent, home or away and tip time, or the live state.
  next: string;
  live?: boolean;
  notes?: ReactNode;
  // Confirm, for a Ready now or Review required option.
  href?: string;
  // The spoken label: the full name and the route ("Naz Reid, ready now").
  label: string;
  // Revealed under "Not valid": not a link.
  notValid?: boolean;
};

function OptionFacts({
  gamesLeft,
  gameDays,
  next,
  live,
  notes,
}: Pick<OptionCardProps, "gamesLeft" | "gameDays" | "next" | "live" | "notes">) {
  return (
    <div className="ocard-facts">
      <div>
        <div className="k">Games left</div>
        <div className="v">
          <b className="num">{gamesLeft}</b> · {gameDays}
        </div>
      </div>
      <div>
        <div className="k">Next</div>
        <div className="v">
          {live && <span className="live mr-[5px] align-[1px]" />}
          {next}
        </div>
      </div>
      {notes && <div className="notes">{notes}</div>}
    </div>
  );
}

export function OptionCard({
  name,
  team,
  positions,
  face,
  average,
  href,
  label,
  notValid = false,
  ...facts
}: OptionCardProps) {
  const shown = optionName(name);
  const body = (
    <>
      <div className="ocard-art">
        <PlayerFace image={face} className="hs" />
        <div className="headline-num">
          <div className="t-card-l">{average}</div>
          <div className="t-micro">Season avg</div>
        </div>
      </div>
      <div className="ocard-id">
        <div className={cn("name ellipsis", shown.step && "is-step")}>{shown.text}</div>
        <div className="meta">
          {team} · {positions}
        </div>
      </div>
      <OptionFacts {...facts} />
    </>
  );
  if (notValid || !href) {
    return (
      <div className={cn("ocard", notValid && "is-not-valid")} style={teamStyle(team)}>
        {body}
      </div>
    );
  }
  return (
    <a className="ocard" style={teamStyle(team)} href={href} aria-label={label}>
      {body}
    </a>
  );
}
