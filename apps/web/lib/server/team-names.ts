import {
  describeFailure,
  findTeamManagerName,
  isDatabaseQueryError,
  listTeamNames,
} from "@injurysub/db";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";

// Each team's stored name and its active manager's first name, for the commissioner's pages that
// name teams (the filing picker, Settings). Null when the database didn't answer.
export type Names = { teams: Map<number, string>; managers: Map<number, string> };

export async function readTeamNames(teamIds: readonly number[]): Promise<Names | null> {
  try {
    const { db } = getWebDatabaseConnection();
    const stored = await listTeamNames(db);
    const managers = await Promise.all(
      teamIds.map(async (teamId) => [teamId, await findTeamManagerName(db, teamId)] as const)
    );
    return {
      teams: new Map(stored.map((each) => [each.teamId, each.name])),
      managers: new Map(
        managers.flatMap(([teamId, name]) => (name === null ? [] : [[teamId, firstName(name)]]))
      ),
    };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.commish.database_failed", undefined, {
      flow: "team_names",
      reason: describeFailure(error),
    });
    return null;
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// "{team name} · {manager}", "Team {N}" without a stored name.
export function teamLabel(teamId: number, names: Names): string {
  const name = names.teams.get(teamId) ?? `Team ${teamId}`;
  const manager = names.managers.get(teamId);
  return manager === undefined ? name : `${name} · ${manager}`;
}
