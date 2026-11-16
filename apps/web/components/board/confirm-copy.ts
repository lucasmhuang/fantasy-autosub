import type { AdjustmentLine as DomainAdjustmentLine } from "@injurysub/domain";
import type { AdjustmentLine } from "@injurysub/ui";
import type { BoardEdit, OptionStatus } from "../../lib/server/board";
import type { ReadyRoute } from "./board-copy";
import { surname } from "./option-copy";

// How a confirmed request goes: sent at once, once approved, made by hand while automation is off
// for the team, or decided by the commissioner (a move InjurySub doesn't make, or a suspension).
export type ConfirmRoute = "now" | "approval" | "off" | "review";

export function confirmRoute(status: OptionStatus, route: ReadyRoute): ConfirmRoute {
  if (status !== "ready_now") return "review";
  return route === "commissioner" ? "off" : route;
}

function routeLabel(route: ConfirmRoute, commissioner: string): string {
  if (route === "now") return "Ready now";
  if (route === "approval") return `Ready once ${commissioner} approves`;
  if (route === "off") return `${commissioner} makes it`;
  return `${commissioner} decides`;
}

function shape(edit: BoardEdit) {
  const injured = edit.items[0];
  const replacement = edit.items.at(-1);
  const moves = edit.items.slice(1, -1);
  const openSlot = moves.length === 0 && replacement?.toSlot !== injured?.fromSlot;
  return { injured, replacement, moves, openSlot };
}

const COUNTS = ["no", "one", "two", "three", "four", "five"];

export function confirmSubtitle(
  route: ConfirmRoute,
  edit: BoardEdit,
  commissioner: string
): string {
  const { injured, replacement, moves, openSlot } = shape(edit);
  let kind: string;
  if (moves.length > 1) kind = `${COUNTS[moves.length] ?? moves.length} other starters would move`;
  else if (moves[0] !== undefined)
    kind = `${moves[0].name} moves to ${moves[0].toSlot} to make room`;
  else if (openSlot) kind = `takes the open ${replacement?.toSlot ?? ""}`;
  else kind = `a straight swap into ${injured?.fromSlot ?? ""}`;
  return `${routeLabel(route, commissioner)} · ${kind}`;
}

export function confirmButtonLabel(
  route: ConfirmRoute,
  amount: string,
  commissioner: string,
  // Shown again after ESPN's lineup changed before Confirm (IF-CONFIRM-5).
  renewed = false
): string {
  if (route === "now") return `Confirm ${renewed ? "new swap" : "swap"} · ${amount}`;
  if (route === "approval") return `Send for approval · ${amount}`;
  return `Send to ${commissioner} · ${amount}`;
}

type AfterCase = {
  route: ConfirmRoute;
  edit: BoardEdit;
  amount: string;
  // Anything is owed, and the adjustment isn't held while the league's rules differ.
  owed: boolean;
  rulesHeld: boolean;
};

// "After you confirm": what happens on ESPN, in order, and who takes over if it doesn't match.
export function afterYouConfirm(at: AfterCase, commissioner: string): string {
  const { injured, replacement, moves, openSlot } = shape(at.edit);
  const coming = surname(replacement?.name ?? "");
  if (at.route === "approval") {
    return `Nothing changes on ESPN until ${commissioner} approves. ${coming}'s points count from now either way.`;
  }
  if (at.route === "off") {
    return `${commissioner} makes this swap on ESPN by hand. ${coming}'s points count from now.`;
  }
  if (at.route === "review") {
    return `${commissioner} makes these moves on ESPN by hand. ${coming}'s points count from now, however long that takes.`;
  }
  if (at.rulesHeld) return "The swap runs now, usually within a minute.";
  if (!at.owed) return "The swap goes to ESPN, usually within a minute.";
  const going = surname(injured?.name ?? "");
  const posts = `${at.amount} posts on ESPN, usually within a minute. If anything doesn't match, ${commissioner} takes over.`;
  if (moves[0] !== undefined) {
    const moved = `${surname(moves[0].name)} moves to ${moves[0].toSlot}`;
    return `${coming} takes ${replacement?.toSlot ?? ""}, ${moved}, ${going} goes to the bench, and ${posts}`;
  }
  const verb = openSlot ? "moves into" : "moves to";
  return `${coming} ${verb} ${replacement?.toSlot ?? ""}, ${going} to the bench, and ${posts}`;
}

export type ChangeRow = {
  playerId: number;
  slot: string;
  name: string;
  text: string;
  bench: boolean;
};

// The lineup changes beyond a straight swap: each moved starter, the replacement, then the
// injured starter to the bench. A straight swap needs none: the cards say it.
export function lineupChangeRows(edit: BoardEdit, review: boolean): ChangeRow[] {
  const { injured, replacement, moves, openSlot } = shape(edit);
  if (injured === undefined || replacement === undefined || (moves.length === 0 && !openSlot)) {
    return [];
  }
  const moved = moves.map((move) => ({
    playerId: move.playerId,
    slot: move.toSlot,
    name: move.name,
    text: review
      ? `Moves from ${move.fromSlot}.`
      : `Moves from ${move.fromSlot}. His points count either way.`,
    bench: false,
  }));
  return [
    ...moved,
    {
      playerId: replacement.playerId,
      slot: replacement.toSlot,
      name: replacement.name,
      text: openSlot
        ? `Comes off the bench into the open ${replacement.toSlot}.`
        : "Comes off the bench.",
      bench: false,
    },
    {
      playerId: injured.playerId,
      slot: "BN",
      name: injured.name,
      text: "Goes to the bench.",
      bench: true,
    },
  ];
}

const KINDS: Record<DomainAdjustmentLine["why"], NonNullable<AdjustmentLine["kind"]>> = {
  injured_credited_before_swap: "start",
  earlier_credit_forfeited: "credit",
  replacement_after_request: "after",
  replacement_on_bench: "bench",
  replacement_before_request: "before",
};

export function adjustmentKind(
  why: DomainAdjustmentLine["why"]
): NonNullable<AdjustmentLine["kind"]> {
  return KINDS[why];
}
