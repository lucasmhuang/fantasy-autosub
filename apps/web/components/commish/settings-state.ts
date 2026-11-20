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

// Under the ticks: what an empty list means. The mode's radios say what a ticked team's requests
// do (copy table 3, 2026-11-20, amending FS-SETTINGS-2).
export const TEAMS_HELPER = "No team ticked: you settle every request by hand.";
