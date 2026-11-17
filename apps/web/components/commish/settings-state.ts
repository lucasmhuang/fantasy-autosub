import type { LeagueExecutionMode } from "@injurysub/domain";

// The settings form's ticks. "All teams" is the form's own: it ticks or unticks every team, and
// reads as ticked only while every team is (Revision 4, F); it posts nothing.
export function withAllTeams(checked: boolean, teamIds: readonly number[]): number[] {
  return checked ? [...teamIds] : [];
}

export function withTeam(ticked: readonly number[], teamId: number, checked: boolean): number[] {
  const others = ticked.filter((each) => each !== teamId);
  return (checked ? [...others, teamId] : others).sort((a, b) => a - b);
}

export function allTicked(ticked: readonly number[], teamIds: readonly number[]): boolean {
  return teamIds.every((teamId) => ticked.includes(teamId));
}

// FS-SETTINGS-2: what a ticked team's requests do, in the mode chosen.
export function teamsHelper(mode: LeagueExecutionMode): string {
  const ticked = mode === "auto" ? "run without you" : "wait for your approval";
  return `No team ticked: you settle every request by hand. A ticked team's requests ${ticked}.`;
}
