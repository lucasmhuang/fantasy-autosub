import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { type FaceImage, PlayerFace } from "./player-face";
import { StatusPill } from "./status-pill";

export type StatLine = { label: string; value: string }[];

export type OutCardProps = {
  name: string;
  slot: string;
  face?: FaceImage | null;
  // Team · positions ("PHI · C").
  teamLine: string;
  // "Next game Thu 7:00 PM PT vs BOS".
  nextGame: string;
  forfeit: string;
  // His points by day while starting ("Mon 46.5"); none before his first points.
  days: string[];
  // "2 games".
  games: string;
  // This week's PTS, REB, AST, STL, BLK and TO.
  stats: StatLine;
  suspended?: boolean;
  // The action: "Choose a replacement" and its count, his request's status, or why no one fits.
  children: ReactNode;
};

function StatStrip({ stats, games }: { stats: StatLine; games: string }) {
  return (
    <div className="stat-strip" aria-label={`This week's stat line, ${games}`}>
      {stats.map(({ label, value }) => (
        <div key={label}>
          <b>{value}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function StartingDays({ days, games }: { days: string[]; games: string }) {
  if (days.length === 0) return <b>No points yet this week</b>;
  return (
    <>
      While starting:{" "}
      {days.map((day) => (
        <Fragment key={day}>
          <b>{day}</b>
          {" · "}
        </Fragment>
      ))}
      {games}
    </>
  );
}

function OutArt({
  name,
  slot,
  face,
  teamLine,
  nextGame,
  forfeit,
  suspended,
}: Omit<OutCardProps, "days" | "games" | "stats" | "children">) {
  return (
    <div className="out-art">
      <div className="ground" />
      <PlayerFace image={face} className="hs" />
      <div className="veil" />
      <div className="copy">
        <div className="flex items-center gap-(--space-8)">
          <span className="out-slot">{slot}</span>
          <StatusPill kind={suspended ? "suspended" : "out"}>
            {suspended ? "Suspended" : "OUT"}
          </StatusPill>
        </div>
        <div className="out-name">{name}</div>
        <div className="out-meta">{teamLine}</div>
        <div className="out-meta">{nextGame}</div>
        <div className={cn("t-eyebrow out-label", suspended && "text-wait")}>
          {suspended ? "If swapped, forfeits" : "A swap forfeits"}
        </div>
        <div className="out-forfeit">
          <span className="t-forfeit">{forfeit}</span>
          <span className="unit">pts</span>
        </div>
      </div>
    </div>
  );
}

// An OUT (or suspended) starter lifted out of the list: the forfeit is the biggest number on
// the board.
export function OutCard({ days, games, stats, children, ...art }: OutCardProps) {
  return (
    <section
      className={cn("out-card", art.suspended && "is-susp")}
      aria-label={`${art.name}, ${art.suspended ? "suspended" : "OUT"}`}
    >
      <OutArt {...art} />
      <div className="out-body">
        <div className="out-days num">
          <StartingDays days={days} games={games} />
        </div>
        <StatStrip stats={stats} games={games} />
        {children}
      </div>
    </section>
  );
}
