import { formatMoment } from "@injurysub/domain";
import type { ProGame } from "@injurysub/espn";
import type { NoteKind } from "@injurysub/ui";
import type { BoardOption } from "../../lib/server/board";
import type { ReadyRoute } from "./board-copy";

export type OptionNote = { kind: NoteKind; text: string };

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

// "Keegan Murray" → "Murray"; a one-word name stays whole.
export function surname(name: string): string {
  const [, ...rest] = name.trim().split(/\s+/);
  return rest.length === 0 ? name : rest.join(" ");
}

function minusPoints(points: number): string {
  return `−${(Math.round(points * 10) / 10).toFixed(1)}`;
}

// What changes the outcome of picking him: the other starter a one-move rearrangement moves, the
// open slot he takes, the starters a commissioner's rearrangement would move, why he isn't valid,
// and points or games that won't count.
export function optionNotes(option: BoardOption): OptionNote[] {
  return [
    ...routeNotes(option),
    ...option.warnings.flatMap((warning) => warningNote(option, warning) ?? []),
  ];
}

function routeNotes(option: BoardOption): OptionNote[] {
  if (option.status === "not_valid") {
    const text =
      option.reason === "taken"
        ? `Named in your request for ${surname(option.takenFor ?? "another starter")}, still in progress.`
        : "No legal lineup with him in it.";
    return [{ kind: "stop", text }];
  }
  const items = option.edit?.items ?? [];
  const injured = items[0];
  const replacement = items.at(-1);
  if (injured === undefined || replacement === undefined) return [];
  const moves = items.slice(1, -1);
  if (option.status === "review_required" && moves.length > 0) {
    const named = moves.map((move) => `${surname(move.name)} to ${move.toSlot}`).join(", ");
    const count = COUNT_WORDS[moves.length] ?? String(moves.length);
    return [{ kind: "review", text: `${count} other starters would move: ${named}.` }];
  }
  if (moves.length === 0) {
    if (replacement.toSlot === injured.fromSlot) return [];
    return [{ kind: "move", text: `Takes the open ${replacement.toSlot}.` }];
  }
  const moved = moves.map((move) => `${move.name} moves to ${move.toSlot}`).join("; ");
  return [
    { kind: "move", text: `${moved}; ${surname(replacement.name)} takes ${replacement.toSlot}.` },
  ];
}

// "No games left" is the card's own Games left 0, so it adds no note.
function warningNote(
  option: BoardOption,
  warning: BoardOption["warnings"][number]
): OptionNote | null {
  if (warning === "already_scored") {
    return {
      kind: "taken",
      text: `${minusPoints(option.weekPoints)} scored before you ask won't count`,
    };
  }
  return null;
}

// The card's spoken label: his full name and where picking him goes.
export function optionLabel(option: BoardOption, route: ReadyRoute, commissioner: string): string {
  if (option.status !== "ready_now" || route === "commissioner") {
    return `${option.name}, ${commissioner} decides`;
  }
  return route === "now"
    ? `${option.name}, ready now`
    : `${option.name}, ready once ${commissioner} approves`;
}

// His games' weekdays from today on ("Wed, Fri, Sun"), in the reader's zone.
export function gameDays(games: readonly ProGame[], zone: string): string {
  if (games.length === 0) return "None";
  return games
    .map((game) => formatMoment(new Date(game.date), zone, "weekday").split(" ")[0])
    .join(", ");
}
