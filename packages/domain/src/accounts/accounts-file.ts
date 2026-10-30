import { normalizeEmailAddress } from "../auth/core";
import { type UserRole, userRoles } from "../auth/roles";

export type AccountRow = { teamId: number; email: string; displayName: string; role: UserRole };

// `row` is the problem's line in the file, as a spreadsheet numbers it (the header is 1), or null
// for the file as a whole. A problem never quotes a cell: the file holds real addresses and names.
export type AccountsFileProblem = { row: number | null; problem: string };

export type AccountsFileResult =
  | { ok: true; rows: AccountRow[] }
  | { ok: false; problems: AccountsFileProblem[] };

const HEADER = ["team_id", "email", "display_name", "role"];
const TEAM_COUNT = 12;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A data row's values, each present only if its cell was valid.
type CheckedRow = Partial<AccountRow> & { line: number };

// Reads the league's accounts file: team_id,email,display_name,role, one row per team. A file with
// any problem is refused whole, and it must be the whole league: 12 rows, teams 1 to 12 once
// each, and exactly one commissioner.
export function parseAccountsFile(text: string): AccountsFileResult {
  const lines = splitLines(text);
  if (!isHeader(lines[0])) {
    return { ok: false, problems: [{ row: 1, problem: `the header must be ${HEADER.join(",")}` }] };
  }
  const problems: AccountsFileProblem[] = [];
  const checked: CheckedRow[] = [];
  lines.slice(1).forEach((line, index) => {
    const row = checkRow(line, index + 2, problems);
    if (row !== undefined) checked.push(row);
  });
  problems.push(...repeatedTeamsAndEmails(checked));
  problems.sort(
    (a, b) => (a.row ?? Number.POSITIVE_INFINITY) - (b.row ?? Number.POSITIVE_INFINITY)
  );
  problems.push(...wholeLeagueProblems(checked, lines.length - 1));
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, rows: checked.filter(isComplete).map(({ line: _line, ...row }) => row) };
}

// A spreadsheet's export reads the same as plain text: a byte-order mark, Windows line endings and
// trailing blank lines are dropped.
function splitLines(text: string): string[] {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
  return lines;
}

function isHeader(line: string | undefined): boolean {
  return line === HEADER.join(",");
}

// Checks one data row, adding its problems. A quoted row, or one with the wrong number of fields,
// isn't read further, since its cells can't be placed.
function checkRow(
  text: string,
  line: number,
  problems: AccountsFileProblem[]
): CheckedRow | undefined {
  if (text.includes('"')) {
    problems.push({ row: line, problem: "quoted fields aren't supported" });
    return undefined;
  }
  const cells = text.split(",").map((cell) => cell.trim());
  const [teamCell = "", emailCell = "", nameCell = "", roleCell = ""] = cells;
  if (cells.length !== HEADER.length) {
    const problem = `has ${cells.length} fields; each row needs ${HEADER.length}: ${HEADER.join(",")}`;
    problems.push({ row: line, problem });
    return undefined;
  }
  const row: CheckedRow = { line };
  const teamId = Number(teamCell);
  if (/^\d+$/.test(teamCell) && teamId >= 1 && teamId <= TEAM_COUNT) row.teamId = teamId;
  else
    problems.push({ row: line, problem: `team_id must be a whole number from 1 to ${TEAM_COUNT}` });
  const email = normalizeEmailAddress(emailCell);
  if (EMAIL_SHAPE.test(email)) row.email = email;
  else problems.push({ row: line, problem: "email isn't a valid address" });
  if (nameCell !== "") row.displayName = nameCell;
  else problems.push({ row: line, problem: "display_name is empty" });
  const role = userRoles.find((known) => known === roleCell);
  if (role !== undefined) row.role = role;
  else problems.push({ row: line, problem: `role must be ${userRoles.join(" or ")}` });
  return row;
}

// Each row whose team or email another row also has, pointing at the first other such row.
function repeatedTeamsAndEmails(rows: CheckedRow[]): AccountsFileProblem[] {
  return [
    ...repeatsOf(rows, (row) => row.teamId, "the same team as row"),
    ...repeatsOf(rows, (row) => row.email, "the same email as row"),
  ];
}

function repeatsOf(
  rows: CheckedRow[],
  keyOf: (row: CheckedRow) => number | string | undefined,
  problem: string
): AccountsFileProblem[] {
  const linesByKey = new Map<number | string, number[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== undefined) linesByKey.set(key, [...(linesByKey.get(key) ?? []), row.line]);
  }
  return [...linesByKey.values()]
    .filter((lines) => lines.length > 1)
    .flatMap((lines) =>
      lines.map((line) => ({
        row: line,
        problem: `${problem} ${lines.find((other) => other !== line)}`,
      }))
    );
}

function wholeLeagueProblems(rows: CheckedRow[], rowCount: number): AccountsFileProblem[] {
  const problems: AccountsFileProblem[] = [];
  if (rowCount !== TEAM_COUNT) {
    const problem = `the file has ${rowCount} rows; the league needs ${TEAM_COUNT}, one for each team`;
    problems.push({ row: null, problem });
  }
  const commissioners = rows.filter((row) => row.role === "commissioner").length;
  if (commissioners !== 1) {
    const problem = `the file names ${commissioners} commissioners; the league needs exactly 1`;
    problems.push({ row: null, problem });
  }
  const teams = new Set(rows.map((row) => row.teamId));
  const missing = Array.from({ length: TEAM_COUNT }, (_, index) => index + 1).filter(
    (team) => !teams.has(team)
  );
  if (missing.length > 0)
    problems.push({ row: null, problem: `no row for team ${missing.join(", ")}` });
  return problems;
}

function isComplete(row: CheckedRow): row is AccountRow & { line: number } {
  return (
    row.teamId !== undefined &&
    row.email !== undefined &&
    row.displayName !== undefined &&
    row.role !== undefined
  );
}
