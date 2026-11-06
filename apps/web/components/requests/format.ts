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
