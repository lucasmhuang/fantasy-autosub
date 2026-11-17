import { type BoardRosterRow, type FoundBoard, loadTeamBoard } from "./board";
import { LEAGUE_TEAM_IDS } from "./commish-settings";
import { type FilingDays, filingDays } from "./filing-days";
import { type Names, readTeamNames, teamLabel } from "./team-names";

export type FilingTeamChoice = { teamId: number; label: string };

// A rostered player the form offers, in his ESPN slot.
export type FilingRosterRow = { slot: string; player: NonNullable<BoardRosterRow["player"]> };

export type FilingLineup =
  | {
      status: "form";
      readAt: string;
      week: { number: number };
      opponent: string | null;
      starters: FilingRosterRow[];
      bench: FilingRosterRow[];
      days: FilingDays;
    }
  | { status: "no_matchup" | "espn_unreadable" | "worker_down" | "season_over" };

export type FilingPage =
  | { status: "database_down" }
  | {
      status: "found";
      teams: FilingTeamChoice[];
      team: { teamId: number; name: string; manager: string | null; lineup: FilingLineup } | null;
    };

// The filing form's page (FS-FILE-1, -2): every team but the commissioner's by its name and its
// manager's first name, and for the team picked, its lineup as the board reads it.
export async function loadFilingPage(input: {
  ownTeamId: number | null;
  team: string | undefined;
  zone: string;
  now: Date;
}): Promise<FilingPage> {
  const offered = LEAGUE_TEAM_IDS.filter((teamId) => teamId !== input.ownTeamId);
  const names = await readTeamNames(offered);
  if (names === null) return { status: "database_down" };
  const teams = offered.map((teamId) => ({ teamId, label: teamLabel(teamId, names) }));
  const teamId = offered.find((each) => String(each) === input.team);
  if (teamId === undefined) return { status: "found", teams, team: null };

  const board = await loadTeamBoard({ teamId, revealAll: false });
  if (board.status === "database_down") return { status: "database_down" };
  const name = names.teams.get(teamId) ?? (board.status === "board" ? board.teamName : null);
  const team = {
    teamId,
    name: name ?? `Team ${teamId}`,
    manager: names.managers.get(teamId) ?? null,
    lineup: lineupOf(board, names, input),
  };
  return { status: "found", teams, team };
}

function lineupOf(
  board: Awaited<ReturnType<typeof loadTeamBoard>>,
  names: Names,
  input: { zone: string; now: Date }
): FilingLineup {
  if (board.status === "season_over" || board.status === "worker_down") {
    return { status: board.status };
  }
  // A stale board is the last read: ESPN can't be read now, so a filing would be refused.
  if (board.status !== "board" || board.stale) return { status: "espn_unreadable" };
  if (board.matchup === null) return { status: "no_matchup" };
  const ids = board.week.days.map((day) => day.scoringPeriodId);
  if (ids.length === 0) return { status: "espn_unreadable" };
  return {
    status: "form",
    readAt: board.readAt,
    week: { number: board.week.matchupPeriodId },
    opponent: opponentName(board, names),
    starters: rostered(board.roster.starters),
    bench: rostered(board.roster.bench),
    days: filingDays({ today: board.week.today, days: ids }, input.now, input.zone),
  };
}

function opponentName(board: FoundBoard, names: Names): string | null {
  const side = board.matchup?.opponent ?? null;
  if (side === null) return null;
  return names.teams.get(side.teamId) ?? side.name ?? `Team ${side.teamId}`;
}

function rostered(rows: BoardRosterRow[]): FilingRosterRow[] {
  return rows.flatMap(({ slot, player }) => (player === null ? [] : [{ slot, player }]));
}
