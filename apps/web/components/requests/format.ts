import type { BoardEdit } from "../../lib/server/board";

type GameToShow = { date: string; opponent: string; home: boolean };

// ESPN's day changes at midnight Pacific, so times show in Pacific: an evening game's UTC date is
// already the next day.
const pacific = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function inPacific(iso: string): string {
  return `${pacific.format(new Date(iso)).replace(",", "")} PT`;
}

export function formatNextGame(game: GameToShow | null): string {
  if (game === null) return "No game scheduled";
  return `${inPacific(game.date)} ${game.home ? "vs" : "@"} ${game.opponent}`;
}

export function formatReadTime(iso: string): string {
  return inPacific(iso);
}

// What an option's edit does beyond the swap itself (R22): the other starter's move and where
// the replacement goes, or the open slot he takes; nothing for a direct swap.
export function describeEdit(edit: BoardEdit): string | null {
  const injured = edit.items[0];
  const replacement = edit.items.at(-1);
  if (injured === undefined || replacement === undefined) return null;
  const moves = edit.items.slice(1, -1);
  if (moves.length === 0) {
    return replacement.toSlot === injured.fromSlot
      ? null
      : `${replacement.name} takes the open ${replacement.toSlot}`;
  }
  const moved = moves.map((move) => `${move.name} moves to ${move.toSlot}`);
  return [...moved, `${replacement.name} takes ${replacement.toSlot}`].join("; ");
}

// Every change an edit makes, in the order sent (R23).
export function editLines(edit: {
  items: readonly { name: string; fromSlot: string; toSlot: string }[];
}): { changes: string[]; unaffected: string | null } {
  const changes = edit.items.map(({ name, fromSlot, toSlot }) => {
    if (toSlot === "BE") return `${name} leaves ${fromSlot} for the bench.`;
    if (fromSlot === "BE") return `${name} comes off the bench into ${toSlot}.`;
    return `${name} moves from ${fromSlot} to ${toSlot}.`;
  });
  const movers = edit.items.slice(1, -1).map(({ name }) => `${name}'s`);
  const slots = movers.length === 1 ? "his slot changes" : "their slots change";
  const unaffected =
    movers.length === 0 ? null : `${movers.join(" and ")} points are unaffected: only ${slots}.`;
  return { changes, unaffected };
}
