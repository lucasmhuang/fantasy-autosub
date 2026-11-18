import {
  formatTenths,
  inverseLineupMoves,
  type LmLineupItem,
  slotLabel,
  teamName,
} from "@injurysub/domain";
import type { FindingFacts } from "./findings";

// ESPN's names for the league's teams and their players, from its lineup read; empty when that
// read failed, so text falls back to numbers.
export type LeagueNames = {
  teamName: (teamId: number) => string | null;
  playerName: (playerId: number) => string | null;
};

// What an alert says it was, and what undoing it takes (M1, M10), as its page and email show it.
// The sentence follows the alert's title (domain's `misuseAlertTitle`), so it names neither the
// kind nor the team again (copy table 1, M).
export function describeFinding(
  facts: FindingFacts,
  teamId: number | null,
  names: LeagueNames
): { what: string; undo: string[] } {
  const team = teamId === null ? "the league" : teamName(teamId, names.teamName(teamId));
  const player = (playerId: number) => names.playerName(playerId) ?? `player ${playerId}`;
  switch (facts.kind) {
    case "lm_transaction":
      return describeTransaction(facts, player);
    case "lm_adjustment":
      return describeAdjustment(facts, team);
    case "lm_league_change":
      return {
        what: `Not made by InjurySub, in the league's ${facts.change.topicType === "ACTIVITY_SETTINGS" ? "settings" : "schedule"} (ESPN message ${facts.change.messageTypeId}).`,
        undo: [
          "Check the league's settings and schedule in ESPN's LM tools, and put back anything changed.",
        ],
      };
    case "league_public":
      return {
        what: "Anyone with its id can read every member's name.",
        undo: ["Set the league back to private in ESPN's league settings."],
      };
    case "adjustment_mismatch":
      return {
        what: `Week ${facts.period}: ${formatTenths(facts.actualTenths)} on ESPN, ${formatTenths(facts.expectedTenths)} in InjurySub's records.`,
        undo: [
          `If InjurySub's records are right: on ESPN's Scoreboard, open Matchup ${facts.period}, then Adjust Scoring on ${team}'s pairing, and set its adjustment to ${formatTenths(facts.expectedTenths)}.`,
        ],
      };
  }
}

function describeAdjustment(
  facts: Extract<FindingFacts, { kind: "lm_adjustment" }>,
  team: string
): { what: string; undo: string[] } {
  const { adjustment, deltaTenths, period } = facts;
  const where = period === null ? `ESPN's matchup id ${adjustment.matchupId}` : `Matchup ${period}`;
  const week = period === null ? `ESPN's matchup id ${adjustment.matchupId}` : `week ${period}`;
  return {
    what: `Not made by InjurySub: ${week}, ${adjustment.totalBefore} → ${adjustment.totalAfter} on ESPN (${formatTenths(deltaTenths, { signed: true })}), note "${adjustment.reason}".`,
    undo: [
      `On ESPN's Scoreboard, open ${where}, then Adjust Scoring on ${team}'s pairing, and change its adjustment by ${formatTenths(-deltaTenths, { signed: true })}.`,
    ],
  };
}

function describeTransaction(
  facts: Extract<FindingFacts, { kind: "lm_transaction" }>,
  player: (playerId: number) => string
): { what: string; undo: string[] } {
  const { transaction, lineupItems } = facts;
  // ESPN logs an upheld trade with no items (2026-11-14), so there are no moves to name.
  if (transaction.items.length === 0) {
    return {
      what: `Made as league manager, not by InjurySub: a ${transaction.type}.`,
      undo: ["Look it up in ESPN's league activity, and reverse it there if you didn't make it."],
    };
  }
  if (lineupItems === null) {
    const items = transaction.items
      .map((item) => `${item.type} ${player(item.playerId)}`)
      .join(", ");
    return {
      what: `Made as league manager, not by InjurySub: ${items}.`,
      undo: [`Reverse it in ESPN's LM tools: ${items}.`],
    };
  }
  const moves = (items: readonly LmLineupItem[]) =>
    items.map(
      (move) =>
        `Move ${player(move.playerId)} from ${slotLabel(move.fromSlot)} to ${slotLabel(move.toSlot)}.`
    );
  const changed = lineupItems
    .map(
      (move) => `${player(move.playerId)} ${slotLabel(move.fromSlot)} → ${slotLabel(move.toSlot)}`
    )
    .join(", ");
  return {
    what: `Made as league manager, not by InjurySub: ${changed}.`,
    undo: moves(inverseLineupMoves(lineupItems)),
  };
}
