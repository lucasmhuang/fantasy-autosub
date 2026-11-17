import type { Logger } from "@injurysub/config";
import { type DatabaseConnection, recordLeagueRulesCheck, recordTeamNames } from "@injurysub/db";
import type { EspnClient } from "@injurysub/espn";
import { readEspn } from "../executor/preflight";

export type LeagueFactsSource = Pick<EspnClient, "getLineups" | "checkLeagueRules">;

type LeagueFactsPass = {
  connection: DatabaseConnection;
  espn: LeagueFactsSource;
  logger: Logger;
  now: Date;
};

// Reads the league's team names and checks its rules, storing each for the commissioner's pages,
// which read no ESPN of their own (Revision 2). Each read records ESPN access, so a worker with
// no cookie leaves "not connected". A refused read keeps what was stored before it; the other
// read still runs.
export async function readLeagueFacts(pass: LeagueFactsPass): Promise<void> {
  const { db } = pass.connection;
  const lineups = await readEspn(pass, () => pass.espn.getLineups());
  if ("value" in lineups) {
    const teams = lineups.value.teams.map(({ teamId, teamName }) => ({ teamId, name: teamName }));
    await recordTeamNames(db, { teams, now: pass.now });
  } else {
    pass.logger.warn("worker.league_facts.espn_unread", { read: "lineups", code: lineups.code });
  }
  const rules = await readEspn(pass, () => pass.espn.checkLeagueRules());
  if ("value" in rules) {
    await recordLeagueRulesCheck(db, { mismatches: rules.value.mismatches, checkedAt: pass.now });
  } else {
    pass.logger.warn("worker.league_facts.espn_unread", { read: "rules", code: rules.code });
  }
}
