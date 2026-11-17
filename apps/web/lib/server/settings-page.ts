import type { LeagueSettings } from "@injurysub/db";
import { teamName } from "@injurysub/domain";
import { LEAGUE_TEAM_IDS, loadSettings } from "./commish-settings";
import { readTeamNames } from "./team-names";

export type SettingsPage =
  | { status: "database_down" }
  | { status: "found"; settings: LeagueSettings; teams: SettingsTeam[] };

// A team by its stored name ("Team {N}" without one) and its manager, the commissioner's "you".
export type SettingsTeam = { teamId: number; name: string; manager: string | null };

// The settings page (FS-SETTINGS-1 to -5): the stored settings and every team by its name and
// manager, the commissioner's own as "you".
export async function loadSettingsPage(input: { ownTeamId: number | null }): Promise<SettingsPage> {
  const view = await loadSettings();
  if (view.status !== "found") return { status: "database_down" };
  const names = await readTeamNames(LEAGUE_TEAM_IDS);
  if (names === null) return { status: "database_down" };
  const teams = LEAGUE_TEAM_IDS.map((teamId) => ({
    teamId,
    name: teamName(teamId, names.teams.get(teamId)),
    manager: teamId === input.ownTeamId ? "you" : (names.managers.get(teamId) ?? null),
  }));
  return { status: "found", settings: view.settings, teams };
}
