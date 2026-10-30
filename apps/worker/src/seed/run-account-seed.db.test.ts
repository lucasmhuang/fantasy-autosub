import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@injurysub/config";
import {
  createSession,
  type DatabaseClient,
  type DatabaseConnection,
  findActiveSessionById,
  findActiveUserAccountByEmail,
  findActiveUserAccountById,
  listUserAccounts,
  sessions,
  userAccounts,
} from "@injurysub/db";
import { normalizeEmailAddress } from "@injurysub/domain";
import type { TestDatabase } from "@injurysub/test-db";
import { afterAll, afterEach, beforeAll, describe, expect, vi } from "vitest";
import { dbTest } from "../test-support";
import { runAccountSeed } from "./run-account-seed";

type Database = TestDatabase<DatabaseConnection>;
type Cells = [string, string, string, string];
type LogLine = Record<string, unknown>;

const now = new Date("2026-10-30T12:00:00.000Z");
const sessionExpiry = new Date("2027-01-01T00:00:00.000Z");
const allTeams = Array.from({ length: 12 }, (_, index) => index + 1);

// An invented league: team n's manager is managern@example.test, and team 1's is the commissioner.
function leagueCells(): Cells[] {
  return allTeams.map((team) => [
    String(team),
    `manager${team}@example.test`,
    `Invented Manager ${team}`,
    team === 1 ? "commissioner" : "manager",
  ]);
}

function setRow(cells: Cells[], team: number, row: Partial<Record<0 | 1 | 2 | 3, string>>) {
  const target = cells[team - 1];
  if (target === undefined) throw new Error(`no row for team ${team}`);
  for (const [column, value] of Object.entries(row)) target[Number(column)] = value;
}

let fileDir = "";
let fileCount = 0;

beforeAll(() => {
  fileDir = mkdtempSync(join(tmpdir(), "seed-accounts-"));
});

afterAll(() => {
  rmSync(fileDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Writes the league, after `edit` changes its cells, to a file and gives its absolute path.
function leagueFile(edit?: (cells: Cells[]) => void): string {
  const cells = leagueCells();
  edit?.(cells);
  fileCount += 1;
  const path = join(fileDir, `league-${fileCount}.csv`);
  const lines = ["team_id,email,display_name,role", ...cells.map((row) => row.join(","))];
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

// Runs the seed with the real logger, capturing the lines it prints.
async function seed(database: Database, filePath: string, apply: boolean) {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  const logger = createLogger("seed", "debug");
  const { exitCode } = await runAccountSeed({
    filePath,
    apply,
    databaseUrl: database.url,
    logger,
    now,
  });
  vi.restoreAllMocks();
  const lines: LogLine[] = printed.map((line) => JSON.parse(line));
  const teams = lines.filter((line) => line.event === "seed.accounts.team");
  const summary = lines.find((line) => line.event === "seed.accounts.summary");
  return { exitCode, printed, lines, teams, summary };
}

function changedTeams(teams: LogLine[]): Record<number, unknown> {
  return Object.fromEntries(
    teams.filter((line) => line.change !== "unchanged").map((line) => [line.teamId, line.change])
  );
}

async function accountByEmail(db: DatabaseClient, email: string) {
  const account = (await listUserAccounts(db)).find((candidate) => candidate.email === email);
  if (account === undefined) throw new Error("expected a stored account for that invented address");
  return account;
}

async function openSession(db: DatabaseClient, email: string, sessionId: string) {
  const account = await accountByEmail(db, email);
  await createSession(db, { sessionId, userId: account.userId, expiresAt: sessionExpiry });
  return account;
}

describe("runAccountSeed", () => {
  dbTest("reports every team as created on a dry run, and writes nothing", async ({ database }) => {
    const run = await seed(database, leagueFile(), false);

    const { hostname, port, pathname } = new URL(database.url);
    expect(run.exitCode).toBe(0);
    expect(run.teams.map((line) => [line.teamId, line.change])).toEqual(
      allTeams.map((team) => [team, "created"])
    );
    expect(run.summary).toMatchObject({
      target: `${hostname}:${port}${pathname}`,
      mode: "dry run",
      created: 12,
      updated: 0,
      reactivated: 0,
      unchanged: 0,
      disabled: 0,
    });
    expect(await database.connection.db.$count(userAccounts)).toBe(0);
  });

  dbTest(
    "creates the league on an apply: one active account per team, one commissioner, on team 1",
    async ({ database }) => {
      const run = await seed(database, leagueFile(), true);

      const accounts = await listUserAccounts(database.connection.db);
      expect(run.exitCode).toBe(0);
      expect(run.summary).toMatchObject({ mode: "applied", created: 12, disabled: 0 });
      expect(
        accounts
          .filter((account) => account.isActive)
          .map((account) => account.teamId)
          .sort((a, b) => (a ?? 0) - (b ?? 0))
      ).toEqual(allTeams);
      expect(
        accounts
          .filter((account) => account.isActive && account.role === "commissioner")
          .map((account) => account.teamId)
      ).toEqual([1]);
    }
  );

  dbTest(
    "changes nothing when the same file is applied again, and keeps everyone signed in",
    async ({ database }) => {
      const { db } = database.connection;
      const file = leagueFile();
      await seed(database, file, true);
      const before = await listUserAccounts(db);
      await openSession(db, "manager3@example.test", "manager3-session");

      const run = await seed(database, file, true);

      expect(run.summary).toMatchObject({
        mode: "applied",
        created: 0,
        updated: 0,
        reactivated: 0,
        unchanged: 12,
        disabled: 0,
      });
      expect(await listUserAccounts(db)).toEqual(before);
      expect(await findActiveSessionById(db, "manager3-session", now)).not.toBeNull();
    }
  );

  dbTest(
    "gives a team whose email changed a new account, and disables and signs out the old one",
    async ({ database }) => {
      const { db } = database.connection;
      await seed(database, leagueFile(), true);
      const old = await openSession(db, "manager5@example.test", "old-address-session");

      const run = await seed(
        database,
        leagueFile((cells) => setRow(cells, 5, { 1: "new.manager5@example.test" })),
        true
      );

      expect(changedTeams(run.teams)).toEqual({ 5: "created" });
      expect(run.summary).toMatchObject({ created: 1, unchanged: 11, disabled: 1 });
      expect(await findActiveUserAccountByEmail(db, "new.manager5@example.test")).toMatchObject({
        teamId: 5,
      });
      expect(await findActiveUserAccountByEmail(db, "manager5@example.test")).toBeNull();
      expect(await findActiveUserAccountById(db, old.userId)).toBeNull();
      expect(await findActiveSessionById(db, "old-address-session", now)).toBeNull();
      const stored = await db.select().from(sessions);
      expect(stored.find((row) => row.sessionId === "old-address-session")?.revokedAt).toEqual(now);
    }
  );

  dbTest(
    "reactivates the old address when its row comes back, and its revoked session stays ended",
    async ({ database }) => {
      const { db } = database.connection;
      await seed(database, leagueFile(), true);
      const original = await openSession(db, "manager5@example.test", "old-address-session");
      await seed(
        database,
        leagueFile((cells) => setRow(cells, 5, { 1: "new.manager5@example.test" })),
        true
      );

      const run = await seed(database, leagueFile(), true);

      expect(changedTeams(run.teams)).toEqual({ 5: "reactivated" });
      expect(run.summary).toMatchObject({ reactivated: 1, disabled: 1 });
      expect(await findActiveUserAccountByEmail(db, "manager5@example.test")).toMatchObject({
        userId: original.userId,
        teamId: 5,
      });
      expect(await findActiveSessionById(db, "old-address-session", now)).toBeNull();
    }
  );

  dbTest("keeps two people's accounts and sessions when they swap teams", async ({ database }) => {
    const { db } = database.connection;
    await seed(database, leagueFile(), true);
    const second = await openSession(db, "manager2@example.test", "manager2-session");
    const third = await openSession(db, "manager3@example.test", "manager3-session");

    const run = await seed(
      database,
      leagueFile((cells) => {
        setRow(cells, 2, { 1: "manager3@example.test", 2: "Invented Manager 3" });
        setRow(cells, 3, { 1: "manager2@example.test", 2: "Invented Manager 2" });
      }),
      true
    );

    expect(run.exitCode).toBe(0);
    expect(changedTeams(run.teams)).toEqual({ 2: "updated", 3: "updated" });
    expect(await accountByEmail(db, "manager3@example.test")).toMatchObject({
      userId: third.userId,
      teamId: 2,
      isActive: true,
    });
    expect(await accountByEmail(db, "manager2@example.test")).toMatchObject({
      userId: second.userId,
      teamId: 3,
      isActive: true,
    });
    expect(await findActiveSessionById(db, "manager2-session", now)).not.toBeNull();
    expect(await findActiveSessionById(db, "manager3-session", now)).not.toBeNull();
  });

  dbTest(
    "hands the commissioner role from team 1 to team 7, leaving one commissioner",
    async ({ database }) => {
      const { db } = database.connection;
      await seed(database, leagueFile(), true);

      const run = await seed(
        database,
        leagueFile((cells) => {
          setRow(cells, 1, { 3: "manager" });
          setRow(cells, 7, { 3: "commissioner" });
        }),
        true
      );

      const commissioners = (await listUserAccounts(db)).filter(
        (account) => account.isActive && account.role === "commissioner"
      );
      expect(run.exitCode).toBe(0);
      expect(commissioners.map((account) => account.teamId)).toEqual([7]);
    }
  );

  dbTest(
    "signs out an account disabled by hand when its row brings it back",
    async ({ database }) => {
      const { db } = database.connection;
      await seed(database, leagueFile(), true);
      await openSession(db, "manager6@example.test", "before-disable-session");
      await database.connection.pool.query(
        "update user_accounts set is_active = false where email = $1",
        ["manager6@example.test"]
      );

      const run = await seed(database, leagueFile(), true);

      expect(changedTeams(run.teams)).toEqual({ 6: "reactivated" });
      expect(await findActiveUserAccountByEmail(db, "manager6@example.test")).not.toBeNull();
      expect(await findActiveSessionById(db, "before-disable-session", now)).toBeNull();
    }
  );

  dbTest(
    "finds the account a padded, mixed-case cell made by an address typed in another case",
    async ({ database }) => {
      await seed(
        database,
        leagueFile((cells) => setRow(cells, 8, { 1: "  Mixed.Case@Example.TEST " })),
        true
      );

      const typed = normalizeEmailAddress(" MIXED.case@example.test ");

      expect(await findActiveUserAccountByEmail(database.connection.db, typed)).toMatchObject({
        teamId: 8,
      });
    }
  );

  dbTest("logs every team once, in team order, then its summary", async ({ database }) => {
    const run = await seed(database, leagueFile(), true);

    expect(run.lines.map((line) => line.event)).toEqual([
      ...allTeams.map(() => "seed.accounts.team"),
      "seed.accounts.summary",
    ]);
    expect(run.teams.map((line) => line.teamId)).toEqual(allTeams);
  });

  dbTest("prints no email address or display name from the file", async ({ database }) => {
    await seed(database, leagueFile(), true);
    const run = await seed(
      database,
      leagueFile((cells) => {
        setRow(cells, 4, { 1: "new.manager4@example.test", 2: "Invented New Manager 4" });
        setRow(cells, 9, { 2: "Invented Renamed Manager 9" });
      }),
      true
    );

    const printed = run.printed.join("\n");
    expect(run.teams).toHaveLength(12);
    expect(printed).not.toMatch(/@example\.test/i);
    expect(printed).not.toContain("Invented");
  });
});
