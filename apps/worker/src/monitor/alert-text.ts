import { formatTenths, inverseLineupMoves, type LmLineupItem } from "@injurysub/domain";
import type { FindingFacts } from "./findings";

// ESPN's names for the league's teams and their players, from its lineup read; empty when that
// read failed, so text falls back to numbers.
export type LeagueNames = {
  teamName: (teamId: number) => string | null;
  playerName: (playerId: number) => string | null;
};

// What an alert says it was, and what undoing it takes (M1, M10), as its page and email show it.
export function describeFinding(
  facts: FindingFacts,
  teamId: number | null,
  names: LeagueNames
): { what: string; undo: string[] } {
  const team = teamId === null ? "the league" : (names.teamName(teamId) ?? `team ${teamId}`);
  const player = (playerId: number) => names.playerName(playerId) ?? `player ${playerId}`;
  switch (facts.kind) {
    case "lm_transaction":
      return describeTransaction(facts, team, player);
    case "lm_adjustment":
      return describeAdjustment(facts, team);
    case "lm_league_change":
      return {
        what: `A league-manager change InjurySub didn't make, in the league's ${facts.change.topicType === "ACTIVITY_SETTINGS" ? "settings" : "schedule"} (ESPN's message type ${facts.change.messageTypeId}).`,
        undo: [
          "Check the league's settings and schedule in ESPN's LM tools, and put back anything changed.",
        ],
      };
    case "league_public":
      return {
        what: "The league is public on ESPN: anyone with its id can read every member's name.",
        undo: ["Set the league back to private in ESPN's league settings."],
      };
    case "adjustment_mismatch":
      return {
        what: `${team}'s adjustment in Matchup ${facts.period} is ${formatTenths(facts.actualTenths)} on ESPN, but InjurySub's records make it ${formatTenths(facts.expectedTenths)}.`,
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
  return {
    what: `A score adjustment InjurySub didn't make on ${team}, ${where}: ESPN's total went from ${adjustment.totalBefore} to ${adjustment.totalAfter} (${formatTenths(deltaTenths, { signed: true })}), reason "${adjustment.reason}".`,
    undo: [
      `On ESPN's Scoreboard, open ${where}, then Adjust Scoring on ${team}'s pairing, and change its adjustment by ${formatTenths(-deltaTenths, { signed: true })}.`,
    ],
  };
}

function describeTransaction(
  facts: Extract<FindingFacts, { kind: "lm_transaction" }>,
  team: string,
  player: (playerId: number) => string
): { what: string; undo: string[] } {
  const { transaction, lineupItems } = facts;
  // ESPN logs an upheld trade with no items (2026-11-14), so there are no moves to name.
  if (transaction.items.length === 0) {
    return {
      what: `A league-manager ${transaction.type} InjurySub didn't make on ${team}.`,
      undo: ["Look it up in ESPN's league activity, and reverse it there if you didn't make it."],
    };
  }
  if (lineupItems === null) {
    const items = transaction.items
      .map((item) => `${item.type} ${player(item.playerId)}`)
      .join(", ");
    return {
      what: `A league-manager ${transaction.type} InjurySub didn't make on ${team}: ${items}.`,
      undo: [`Reverse it in ESPN's LM tools: ${items}.`],
    };
  }
  const moves = (items: readonly LmLineupItem[]) =>
    items.map((move) => `Move ${player(move.playerId)} from ${move.fromSlot} to ${move.toSlot}.`);
  return {
    what: `A league-manager lineup edit InjurySub didn't make on ${team}, from ESPN's day ${transaction.scoringPeriodId}: ${moves(lineupItems).join(" ")}`,
    undo: moves(inverseLineupMoves(lineupItems)),
  };
}
