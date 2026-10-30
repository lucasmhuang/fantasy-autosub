import { describe, expect, it } from "vitest";
import { type AccountSyncPlan, type ExistingAccount, planAccountSync } from "./account-sync";
import type { AccountRow } from "./accounts-file";

// An invented league, as the accounts file gives it: team 1's manager is the commissioner.
function leagueRows(): AccountRow[] {
  return Array.from({ length: 12 }, (_, index) => ({
    teamId: index + 1,
    email: `manager${index + 1}@example.test`,
    displayName: `Invented Manager ${index + 1}`,
    role: index === 0 ? "commissioner" : "manager",
  }));
}

// The store after seeding `rows`: one active account per row, with an invented id.
function storedAccounts(rows: AccountRow[]): ExistingAccount[] {
  return rows.map((row) => ({ ...row, userId: `user-${row.teamId}`, isActive: true }));
}

function rowFor(rows: AccountRow[], team: number): AccountRow {
  const row = rows.find((candidate) => candidate.teamId === team);
  if (row === undefined) throw new Error(`no row for team ${team}`);
  return row;
}

function changedTeams(plan: AccountSyncPlan): Record<number, string> {
  return Object.fromEntries(
    plan.teams
      .filter((team) => team.change !== "unchanged")
      .map((team) => [team.teamId, team.change])
  );
}

describe("planAccountSync", () => {
  it("creates every team's account in an empty store", () => {
    const plan = planAccountSync([], leagueRows());

    expect(plan.teams.map((team) => team.teamId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(plan.teams.every((team) => team.change === "created")).toBe(true);
    expect(plan.disabledUserIds).toEqual([]);
    expect(plan.reactivatedUserIds).toEqual([]);
  });

  it("lists the teams in team order, whatever the file's order", () => {
    const plan = planAccountSync([], [...leagueRows()].reverse());

    expect(plan.teams.map((team) => team.teamId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("changes nothing when the file matches the store", () => {
    const plan = planAccountSync(storedAccounts(leagueRows()), leagueRows());

    expect(plan.teams.every((team) => team.change === "unchanged")).toBe(true);
    expect(plan).toMatchObject({ disabledUserIds: [], reactivatedUserIds: [] });
  });

  it("updates a team whose display name changed", () => {
    const rows = leagueRows();
    rowFor(rows, 4).displayName = "Invented Manager Four";

    const plan = planAccountSync(storedAccounts(leagueRows()), rows);

    expect(changedTeams(plan)).toEqual({ 4: "updated" });
  });

  it("gives a team whose email changed a new account, and disables the old one", () => {
    const rows = leagueRows();
    rowFor(rows, 5).email = "new.manager5@example.test";

    const plan = planAccountSync(storedAccounts(leagueRows()), rows);

    expect(changedTeams(plan)).toEqual({ 5: "created" });
    expect(plan.disabledUserIds).toEqual(["user-5"]);
    expect(plan.reactivatedUserIds).toEqual([]);
  });

  it("reactivates a disabled account whose row is back", () => {
    const store = storedAccounts(leagueRows()).map((account) =>
      account.teamId === 6 ? { ...account, isActive: false } : account
    );

    const plan = planAccountSync(store, leagueRows());

    expect(changedTeams(plan)).toEqual({ 6: "reactivated" });
    expect(plan.reactivatedUserIds).toEqual(["user-6"]);
    expect(plan.disabledUserIds).toEqual([]);
  });

  it("updates both teams when two people swap teams, keeping each one's account", () => {
    const rows = leagueRows();
    Object.assign(rowFor(rows, 2), {
      email: "manager3@example.test",
      displayName: "Invented Manager 3",
    });
    Object.assign(rowFor(rows, 3), {
      email: "manager2@example.test",
      displayName: "Invented Manager 2",
    });

    const plan = planAccountSync(storedAccounts(leagueRows()), rows);

    expect(changedTeams(plan)).toEqual({ 2: "updated", 3: "updated" });
    expect(plan).toMatchObject({ disabledUserIds: [], reactivatedUserIds: [] });
  });

  it("updates both rows when the commissioner role moves from team 1 to team 7", () => {
    const rows = leagueRows();
    rowFor(rows, 1).role = "manager";
    rowFor(rows, 7).role = "commissioner";

    const plan = planAccountSync(storedAccounts(leagueRows()), rows);

    expect(changedTeams(plan)).toEqual({ 1: "updated", 7: "updated" });
  });

  it("disables an account made by hand that isn't in the file", () => {
    const handMade: ExistingAccount = {
      userId: "user-hand-made",
      email: "local.tester@example.test",
      teamId: null,
      displayName: "Invented Local Tester",
      role: "manager",
      isActive: true,
    };

    const plan = planAccountSync([...storedAccounts(leagueRows()), handMade], leagueRows());

    expect(plan.disabledUserIds).toEqual(["user-hand-made"]);
    expect(changedTeams(plan)).toEqual({});
  });

  it("matches a stored email exactly as stored, so a mixed-case one isn't the file's row", () => {
    const rows = leagueRows();
    rowFor(rows, 8).email = "mixed@case.test";
    const store = storedAccounts(leagueRows()).map((account) =>
      account.teamId === 8 ? { ...account, email: "Mixed@Case.test" } : account
    );

    const plan = planAccountSync(store, rows);

    expect(changedTeams(plan)).toEqual({ 8: "created" });
    expect(plan.disabledUserIds).toEqual(["user-8"]);
  });

  it("leaves an already disabled account that isn't in the file alone", () => {
    const formerManager: ExistingAccount = {
      userId: "user-former",
      email: "former.manager@example.test",
      teamId: 9,
      displayName: "Invented Former Manager",
      role: "manager",
      isActive: false,
    };

    const plan = planAccountSync([...storedAccounts(leagueRows()), formerManager], leagueRows());

    expect(plan).toMatchObject({ disabledUserIds: [], reactivatedUserIds: [] });
    expect(changedTeams(plan)).toEqual({});
  });
});
