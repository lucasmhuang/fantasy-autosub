import { describe, expect, it } from "vitest";
import { type AccountsFileProblem, parseAccountsFile } from "./accounts-file";

const header = "team_id,email,display_name,role";

// An invented league: team n's manager is managern@example.test, and team 1's is the commissioner.
function leagueCells(): string[][] {
  return Array.from({ length: 12 }, (_, index) => [
    String(index + 1),
    `manager${index + 1}@example.test`,
    `Invented Manager ${index + 1}`,
    index === 0 ? "commissioner" : "manager",
  ]);
}

// The league as a file, after `edit` changes its cells. Line 1 is the header, so team n is on
// line n + 1.
function leagueFile(edit?: (cells: string[][]) => void, lineEnding = "\n"): string {
  const cells = leagueCells();
  edit?.(cells);
  return [header, ...cells.map((row) => row.join(","))].join(lineEnding) + lineEnding;
}

function problemsOf(text: string): AccountsFileProblem[] {
  const result = parseAccountsFile(text);
  if (result.ok) throw new Error("expected the file to be refused");
  return result.problems;
}

function rowsOf(text: string) {
  const result = parseAccountsFile(text);
  if (!result.ok)
    throw new Error(`expected the file to be read: ${JSON.stringify(result.problems)}`);
  return result.rows;
}

function setCell(cells: string[][], team: number, column: number, value: string) {
  const row = cells[team - 1];
  if (row === undefined) throw new Error(`no row for team ${team}`);
  row[column] = value;
}

describe("parseAccountsFile", () => {
  it("reads a whole league, with each email trimmed and lowercased", () => {
    const rows = rowsOf(leagueFile((cells) => setCell(cells, 3, 1, "  Manager3@Example.TEST ")));

    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      teamId: 1,
      email: "manager1@example.test",
      displayName: "Invented Manager 1",
      role: "commissioner",
    });
    expect(rows[2]?.email).toBe("manager3@example.test");
    expect(rows.map((row) => row.teamId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("reads a spreadsheet's export the same: a byte-order mark, Windows line endings, trailing blank lines", () => {
    const exported = `﻿${leagueFile(undefined, "\r\n")}\r\n\r\n`;

    expect(rowsOf(exported)).toEqual(rowsOf(leagueFile()));
  });

  it("refuses a wrong header, and reads no further", () => {
    const text = leagueFile().replace(header, "team,email,name,role");

    expect(problemsOf(text)).toEqual([
      { row: 1, problem: "the header must be team_id,email,display_name,role" },
    ]);
  });

  it("refuses a row with five fields, and a row with a quoted field", () => {
    const problems = problemsOf(
      leagueFile((cells) => {
        setCell(cells, 4, 2, "Invented, Manager 4");
        setCell(cells, 5, 2, '"Invented Manager 5"');
      })
    );

    expect(problems).toContainEqual({
      row: 5,
      problem: "has 5 fields; each row needs 4: team_id,email,display_name,role",
    });
    expect(problems).toContainEqual({ row: 6, problem: "quoted fields aren't supported" });
  });

  it("refuses team ids 0 and 13, and names the teams left without a row", () => {
    const problems = problemsOf(
      leagueFile((cells) => {
        setCell(cells, 1, 0, "0");
        setCell(cells, 12, 0, "13");
      })
    );

    expect(problems).toContainEqual({
      row: 2,
      problem: "team_id must be a whole number from 1 to 12",
    });
    expect(problems).toContainEqual({
      row: 13,
      problem: "team_id must be a whole number from 1 to 12",
    });
    expect(problems).toContainEqual({ row: null, problem: "no row for team 1, 12" });
  });

  it("flags both rows of a repeated team, and of two emails that differ only in case", () => {
    const problems = problemsOf(
      leagueFile((cells) => {
        setCell(cells, 8, 0, "7");
        setCell(cells, 10, 1, "MANAGER9@example.test");
      })
    );

    expect(problems).toContainEqual({ row: 8, problem: "the same team as row 9" });
    expect(problems).toContainEqual({ row: 9, problem: "the same team as row 8" });
    expect(problems).toContainEqual({ row: 10, problem: "the same email as row 11" });
    expect(problems).toContainEqual({ row: 11, problem: "the same email as row 10" });
  });

  it("refuses a league with no commissioner, or with two", () => {
    const none = problemsOf(leagueFile((cells) => setCell(cells, 1, 3, "manager")));
    const two = problemsOf(leagueFile((cells) => setCell(cells, 6, 3, "commissioner")));

    expect(none).toEqual([
      { row: null, problem: "the file names 0 commissioners; the league needs exactly 1" },
    ]);
    expect(two).toEqual([
      { row: null, problem: "the file names 2 commissioners; the league needs exactly 1" },
    ]);
  });

  it("refuses a file that isn't the whole league: 11 rows, or 13", () => {
    const eleven = problemsOf(leagueFile((cells) => cells.pop()));
    const thirteen = problemsOf(
      leagueFile((cells) => {
        cells.push(["12", "extra@example.test", "Invented Extra", "manager"]);
      })
    );

    expect(eleven).toContainEqual({
      row: null,
      problem: "the file has 11 rows; the league needs 12, one for each team",
    });
    expect(eleven).toContainEqual({ row: null, problem: "no row for team 12" });
    expect(thirteen).toContainEqual({
      row: null,
      problem: "the file has 13 rows; the league needs 12, one for each team",
    });
  });

  it("refuses a bad email, an empty name, and the roles Manager and admin", () => {
    const problems = problemsOf(
      leagueFile((cells) => {
        setCell(cells, 2, 1, "manager2.example.test");
        setCell(cells, 3, 2, "   ");
        setCell(cells, 4, 3, "Manager");
        setCell(cells, 5, 3, "admin");
      })
    );

    expect(problems).toEqual([
      { row: 3, problem: "email isn't a valid address" },
      { row: 4, problem: "display_name is empty" },
      { row: 5, problem: "role must be manager or commissioner" },
      { row: 6, problem: "role must be manager or commissioner" },
    ]);
  });

  it("never names an email address or a display name in its problems", () => {
    const text = leagueFile((cells) => {
      setCell(cells, 2, 1, "not-an-address");
      setCell(cells, 3, 1, "MANAGER2@example.test");
      setCell(cells, 4, 0, "40");
      setCell(cells, 5, 2, '"Quoted Name"');
      setCell(cells, 6, 3, "admin");
    });

    const reported = JSON.stringify(problemsOf(text));

    expect(reported).not.toMatch(/@example\.test/i);
    expect(reported).not.toContain("not-an-address");
    expect(reported).not.toMatch(/Invented|Quoted Name/);
    expect(reported).not.toContain("admin");
  });
});
