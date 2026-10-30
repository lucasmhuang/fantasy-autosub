import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createLogger } from "@injurysub/config";
import {
  createSession,
  type DatabaseClient,
  type DatabaseConnection,
  findActiveSessionById,
  findActiveUserAccountByEmail,
  findActiveUserAccountById,
  listUserAccounts,
  lockUserAccountsForSync,
  sessions,
  userAccounts,
} from "@injurysub/db";
import { normalizeEmailAddress } from "@injurysub/domain";
import { cutConnectionAt, type TestDatabase } from "@injurysub/test-db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbTest, unmigratedDbTest } from "../test-support";
import { FAILURE_HINTS, UNKNOWN_OUTCOME_HINT } from "./failure";
import { type AccountSeedOptions, runAccountSeed } from "./run-account-seed";

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

// Runs the seed with the real logger, capturing the lines it prints. A failed run logs exactly one
// failure line, whose code, reason, hint and outcome `failure` gives.
async function runSeed(options: Omit<AccountSeedOptions, "logger" | "now">) {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  const logger = createLogger("seed", "debug");
  const { exitCode } = await runAccountSeed({ ...options, logger, now });
  vi.restoreAllMocks();
  const lines: LogLine[] = printed.map((line) => JSON.parse(line));
  const teams = lines.filter((line) => line.event === "seed.accounts.team");
  const summary = lines.find((line) => line.event === "seed.accounts.summary");
  const failures = lines.filter((line) => line.event === "seed.accounts.failed");
  expect(failures.length).toBeLessThanOrEqual(1);
  const failure = failures.map(({ code, reason, hint, outcome, target }) => ({
    code,
    reason,
    hint,
    outcome,
    target,
  }))[0];
  return { exitCode, printed, lines, teams, summary, failure };
}

function seed(
  database: Database,
  filePath: string,
  apply: boolean,
  options: Partial<AccountSeedOptions> = {}
) {
  return runSeed({ filePath, apply, databaseUrl: database.url, ...options });
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

describe("runAccountSeed's failures", () => {
  // Nothing listens there, so a run that got as far as connecting would fail on the connection.
  const deadDatabaseUrl = "postgres://seed-probe-user:secret-probe-pw@127.0.0.2:1/x";
  const silentServers: Server[] = [];
  const silentSockets = new Set<Socket>();

  afterAll(async () => {
    for (const socket of silentSockets) socket.destroy();
    await Promise.all(
      silentServers.map((server) => new Promise((resolve) => server.close(resolve)))
    );
  });

  // Takes connections and never answers, like a server that has hung.
  async function silentServerUrl(): Promise<string> {
    const server = createServer((socket) => {
      silentSockets.add(socket);
    });
    silentServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP address");
    return `postgres://seed-probe-user@127.0.0.1:${address.port}/x`;
  }

  it("refuses a relative path before reading anything", async () => {
    const run = await runSeed({
      filePath: relative(process.cwd(), leagueFile()),
      apply: true,
      databaseUrl: deadDatabaseUrl,
    });

    expect(run.exitCode).toBe(1);
    expect(run.failure).toMatchObject({
      code: "path_not_absolute",
      reason: "relative_path",
      hint: FAILURE_HINTS.path_not_absolute,
    });
  });

  it("refuses a database off this machine whose URL doesn't say how to encrypt, before connecting", async () => {
    const run = await runSeed({
      filePath: leagueFile(),
      apply: false,
      databaseUrl: "postgres://seed-probe-user:secret-probe-pw@db.example.test:5432/x",
    });

    expect(run.failure).toEqual({
      code: "tls_unspecified",
      reason: "no_sslmode",
      hint: FAILURE_HINTS.tls_unspecified,
      target: "db.example.test:5432/x",
    });
    expect(run.printed.join("\n")).not.toMatch(/seed-probe-user|secret-probe-pw/);
  });

  it("names an unparseable database URL by its error code, never its text", async () => {
    const run = await runSeed({
      filePath: leagueFile(),
      apply: false,
      databaseUrl: "postgres://seed-probe-user:secret-probe-pw@[not-a-host/x",
    });

    expect(run.failure).toEqual({
      code: "database_failure",
      reason: "ERR_INVALID_URL",
      hint: FAILURE_HINTS.database_failure,
    });
    expect(run.printed.join("\n")).not.toMatch(/seed-probe-user|secret-probe-pw|not-a-host/);
  });

  it("refuses a missing file, naming ENOENT", async () => {
    const run = await runSeed({
      filePath: join(fileDir, "missing.csv"),
      apply: false,
      databaseUrl: deadDatabaseUrl,
    });

    expect(run.failure).toMatchObject({
      code: "file_unreadable",
      reason: "ENOENT",
      hint: FAILURE_HINTS.file_unreadable,
    });
  });

  dbTest(
    "refuses a malformed file by its rows, and leaves the accounts as they were",
    async ({ database }) => {
      const { db } = database.connection;
      await seed(database, leagueFile(), true);
      const before = await listUserAccounts(db);

      const run = await seed(
        database,
        leagueFile((cells) => {
          setRow(cells, 3, { 1: "not-an-address" });
          setRow(cells, 9, { 3: "admin" });
        }),
        true
      );

      expect(run.failure).toMatchObject({
        code: "file_invalid",
        reason: "malformed",
        hint: FAILURE_HINTS.file_invalid,
      });
      const problems = run.lines.filter((line) => line.event === "seed.accounts.file_problem");
      expect(problems.map(({ row, problem }) => ({ row, problem }))).toEqual([
        { row: 4, problem: "email isn't a valid address" },
        { row: 10, problem: "role must be manager or commissioner" },
      ]);
      expect(run.printed.join("\n")).not.toMatch(/not-an-address|admin|@example\.test|Invented/);
      expect(await listUserAccounts(db)).toEqual(before);
    }
  );

  it("gives up on a server that never answers, naming a timeout", async () => {
    const started = Date.now();

    const run = await runSeed({
      filePath: leagueFile(),
      apply: false,
      databaseUrl: await silentServerUrl(),
      connectionTimeoutMs: 500,
    });

    expect(run.failure).toMatchObject({
      code: "database_unreachable",
      reason: "timeout",
      hint: FAILURE_HINTS.database_unreachable,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("refuses a closed port, naming ECONNREFUSED and the target, and neither the user nor the password", async () => {
    const run = await runSeed({
      filePath: leagueFile(),
      apply: false,
      databaseUrl: deadDatabaseUrl,
    });

    expect(run.failure).toEqual({
      code: "database_unreachable",
      reason: "ECONNREFUSED",
      hint: FAILURE_HINTS.database_unreachable,
      target: "127.0.0.2:1/x",
    });
    expect(run.printed.join("\n")).not.toMatch(/seed-probe-user|secret-probe-pw/);
  });

  unmigratedDbTest(
    "refuses a database without the app's schema, before reading any account",
    async ({ database }) => {
      const run = await seed(database, leagueFile(), false);

      expect(run.failure).toMatchObject({
        code: "schema_missing",
        reason: "no_accounts_table",
        hint: FAILURE_HINTS.schema_missing,
      });
      expect(run.teams).toEqual([]);
    }
  );

  dbTest("refuses a database behind this checkout's migrations", async ({ database }) => {
    await database.connection.pool.query(
      "delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)"
    );

    const run = await seed(database, leagueFile(), true);

    expect(run.failure).toMatchObject({
      code: "schema_outdated",
      reason: "behind",
      hint: FAILURE_HINTS.schema_outdated,
    });
    expect(await database.connection.db.$count(userAccounts)).toBe(0);
  });

  dbTest("refuses a database a newer checkout migrated", async ({ database }) => {
    await database.connection.pool.query(
      "insert into drizzle.__drizzle_migrations (hash, created_at) select 'from-a-newer-checkout', max(created_at) + 1000 from drizzle.__drizzle_migrations"
    );

    const run = await seed(database, leagueFile(), false);

    expect(run.failure).toMatchObject({
      code: "schema_ahead",
      reason: "ahead",
      hint: FAILURE_HINTS.schema_ahead,
    });
  });

  dbTest(
    "rolls back a write that fails midway, naming its SQLSTATE and none of its data",
    async ({ database }) => {
      const { db, pool } = database.connection;
      await seed(
        database,
        leagueFile((cells) => setRow(cells, 7, { 1: "earlier.manager7@example.test" })),
        true
      );
      await pool.query(
        "alter table user_accounts add constraint seed_probe_check check (email <> 'manager7@example.test')"
      );
      const before = await listUserAccounts(db);

      const run = await seed(database, leagueFile(), true);

      expect(run.failure).toMatchObject({
        code: "database_failure",
        reason: "23514",
        hint: FAILURE_HINTS.database_failure,
      });
      expect(run.teams).toEqual([]);
      expect(run.summary).toBeUndefined();
      expect(await listUserAccounts(db)).toEqual(before);
      const printed = run.printed.join("\n");
      for (const leak of ["@example.test", "Invented", "Failed query", "params:", "Key ("]) {
        expect(printed).not.toContain(leak);
      }
    }
  );

  dbTest(
    "names a unique violation by its SQLSTATE, never by the address in its detail",
    async ({ database }) => {
      const { pool } = database.connection;
      await pool.query(
        "create unique index seed_probe_lower_email on user_accounts (lower(email))"
      );
      await pool.query(
        "insert into user_accounts (user_id, email, display_name, role, is_active) values (gen_random_uuid(), 'MANAGER9@example.test', 'Invented Hand-Made Account', 'manager', false)"
      );

      const run = await seed(database, leagueFile(), true);

      expect(run.failure).toMatchObject({ code: "database_failure", reason: "23505" });
      expect(run.printed.join("\n")).not.toMatch(/manager9|@example\.test|Key \(/i);
    }
  );

  dbTest(
    "makes an apply give up while another sync holds the lock, writing nothing",
    async ({ database }) => {
      const runs: Awaited<ReturnType<typeof seed>>[] = [];

      await database.connection.db.transaction(async (tx) => {
        await lockUserAccountsForSync(tx);
        runs.push(await seed(database, leagueFile(), true, { lockWaitMs: 200 }));
      });

      expect(runs[0]?.failure).toMatchObject({ code: "database_failure", reason: "55P03" });
      expect(await database.connection.db.$count(userAccounts)).toBe(0);
    }
  );

  dbTest(
    "reports a connection lost at the apply's begin, and exits with 1",
    async ({ database }) => {
      const proxy = await cutConnectionAt(database.url, "begin");
      try {
        const outcome = await Promise.race([
          seed(database, leagueFile(), true, { databaseUrl: proxy.url }),
          sleep(10_000).then(() => "the seed never returned"),
        ]);

        expect(outcome).toMatchObject({
          exitCode: 1,
          failure: {
            code: "database_failure",
            reason: "connection_lost",
            hint: FAILURE_HINTS.database_failure,
          },
        });
        expect(await database.connection.db.$count(userAccounts)).toBe(0);
      } finally {
        await proxy.close();
      }
    }
  );

  dbTest(
    "reports a connection lost inside the apply as lost, and writes nothing",
    async ({ database }) => {
      const proxy = await cutConnectionAt(database.url, "lock table");
      try {
        const run = await seed(database, leagueFile(), true, { databaseUrl: proxy.url });

        expect(run.exitCode).toBe(1);
        expect(run.failure).toMatchObject({
          code: "database_failure",
          reason: "connection_lost",
          hint: FAILURE_HINTS.database_failure,
        });
        expect(await database.connection.db.$count(userAccounts)).toBe(0);
      } finally {
        await proxy.close();
      }
    }
  );

  dbTest(
    "says a cut-off commit's outcome is unknown, and reports none of its changes",
    async ({ database }) => {
      // At commit, the seed's own connection is ended from inside the database.
      await database.connection.pool.query(`
      create function seed_probe_end_own_connection() returns trigger language plpgsql as $$
        begin perform pg_terminate_backend(pg_backend_pid()); return null; end $$;
      create constraint trigger seed_probe_end_at_commit after insert on user_accounts
        deferrable initially deferred for each row execute function seed_probe_end_own_connection();
    `);

      const run = await seed(database, leagueFile(), true);

      const { hostname, port, pathname } = new URL(database.url);
      expect(run.exitCode).toBe(1);
      expect(run.failure).toEqual({
        code: "database_failure",
        reason: "connection_lost",
        hint: UNKNOWN_OUTCOME_HINT,
        outcome: "unknown",
        target: `${hostname}:${port}${pathname}`,
      });
      expect(run.teams).toEqual([]);
      expect(run.summary).toBeUndefined();
      expect(await database.connection.db.$count(userAccounts)).toBe(0);
    }
  );
});
