import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { LogContext, Logger } from "@injurysub/config";
import {
  createDatabaseConnection,
  type DatabaseClient,
  type DatabaseConnection,
  deactivateAllUserAccounts,
  listUserAccounts,
  lockUserAccountsForSync,
  readMigrationState,
  revokeSessionsForUsers,
  upsertUserAccountByEmail,
} from "@injurysub/db";
import {
  type AccountChange,
  type AccountRow,
  type AccountSyncPlan,
  parseAccountsFile,
  planAccountSync,
} from "@injurysub/domain";
import { SeedError } from "./errors";
import { describeFailure, FAILURE_HINTS, UNKNOWN_OUTCOME_HINT } from "./failure";

export type AccountSeedOptions = {
  filePath: string;
  apply: boolean;
  databaseUrl: string;
  logger: Logger;
  now: Date;
  connectionTimeoutMs?: number;
  lockWaitMs?: number;
};

// Whether the apply's transaction body finished, so that a failure came at or after its commit.
type SeedProgress = { bodyFinished: boolean };

// localhost, 127.0.0.0/8 and ::1 are this machine.
const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;
const PLAIN_HOST = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/;
const PLAIN_DATABASE = /^[A-Za-z0-9._-]+$/;
// pg takes these from the query over the URL's own host and port (pg-connection-string 2.12.0
// index.js:41 and :54-63).
const TARGET_PARAMETERS = ["host", "hostaddr", "port"];

// Brings a database's accounts in line with the league's accounts file. Unless `apply`, it's a dry
// run: it reports each team's change and writes nothing. An apply makes every change in one
// transaction and reports them once it has committed. A failure logs one line, with a code, a safe
// reason and a fixed hint. Nothing it prints names an email address, a display name, or the
// database's credentials.
export async function runAccountSeed(options: AccountSeedOptions): Promise<{ exitCode: 0 | 1 }> {
  const progress: SeedProgress = { bodyFinished: false };
  try {
    await seedAccounts(options, progress);
    return { exitCode: 0 };
  } catch (error) {
    const target = targetOf(options.databaseUrl);
    options.logger.error("seed.accounts.failed", undefined, {
      ...failureLine(error, progress),
      ...(target === undefined ? {} : { target }),
    });
    return { exitCode: 1 };
  }
}

async function seedAccounts(options: AccountSeedOptions, progress: SeedProgress): Promise<void> {
  if (!isAbsolute(options.filePath)) {
    throw new SeedError(
      "path_not_absolute",
      "The accounts file needs an absolute path",
      "relative_path"
    );
  }
  requireEncryptionSetting(requireSupportedUrl(options.databaseUrl));
  const rows = await readAccountRows(options.filePath, options.logger);
  const connection = openConnection(options);
  try {
    await requireReachable(connection);
    await requireCurrentSchema(connection.db);
    const plan = options.apply
      ? await applyAccountSync(connection, rows, options, progress)
      : planAccountSync(await listUserAccounts(connection.db), rows);
    const mode = options.apply ? "applied" : "dry run";
    reportPlan(options.logger, plan, { target: targetOf(options.databaseUrl) ?? "", mode });
  } finally {
    await connection.close();
  }
}

// The seed names its target, so the URL must say truthfully where it connects, and naming it must
// print no credential: the host, port and database must be plain parts of the URL. pg would take
// a host or port from the query instead, and an unencoded "/" or "@" in the password shifts the
// parts, putting some of the password where the host or the database should be.
function requireSupportedUrl(databaseUrl: string): URL {
  const url = new URL(databaseUrl);
  if (TARGET_PARAMETERS.some((name) => url.searchParams.has(name))) {
    throw new SeedError(
      "database_url_unsupported",
      "The database URL names its target in its query",
      "target_in_query"
    );
  }
  if (plainTarget(url) === undefined) {
    throw new SeedError(
      "database_url_unsupported",
      "The database URL's host, port or database isn't plain",
      "not_plain"
    );
  }
  return url;
}

// Even a dry run reads the real addresses, so a database off this machine must say how to encrypt.
function requireEncryptionSetting(url: URL) {
  if (LOOPBACK_HOST.test(url.hostname)) return;
  if (url.searchParams.has("sslmode") || url.searchParams.has("ssl")) return;
  throw new SeedError(
    "tls_unspecified",
    "A database that isn't on this machine needs an encryption setting",
    "no_sslmode"
  );
}

async function readAccountRows(filePath: string, logger: Logger): Promise<AccountRow[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new SeedError(
      "file_unreadable",
      "The accounts file can't be read",
      describeFailure(error)
    );
  }
  const result = parseAccountsFile(text);
  if (result.ok) return result.rows;
  for (const { row, problem } of result.problems) {
    logger.warn("seed.accounts.file_problem", { row, problem });
  }
  throw new SeedError("file_invalid", "The accounts file has problems", "malformed");
}

// pg also reports a lost connection as an error event: on the pool for an idle client, and on the
// client itself while a query holds it, since pg-pool takes its own listener off then. Unheard,
// the event crashes the process. The loss also reaches the seed as the failed query's error,
// whose cause chain names it, so the listeners have nothing more to do.
function openConnection(options: AccountSeedOptions): DatabaseConnection {
  const connection = createDatabaseConnection({
    connectionString: options.databaseUrl,
    applicationName: "injurysub-seed",
    maxConnections: 1,
    connectionTimeoutMs: options.connectionTimeoutMs ?? 5_000,
  });
  connection.pool.on("error", ignoreLostConnection);
  connection.pool.on("connect", (client) => {
    client.on("error", ignoreLostConnection);
  });
  return connection;
}

function ignoreLostConnection(): void {}

async function requireReachable(connection: DatabaseConnection) {
  try {
    await connection.check();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const reason = describeFailure(error);
    throw new SeedError("database_unreachable", "The database can't be reached", reason);
  }
}

// Refused before any account is read: no app schema, migrations still to run, or a database a
// newer checkout migrated.
async function requireCurrentSchema(db: DatabaseClient) {
  const { hasAccountsTable, latestApplied, latestKnown } = await readMigrationState(db);
  if (!hasAccountsTable) {
    throw new SeedError(
      "schema_missing",
      "The database lacks the app's schema",
      "no_accounts_table"
    );
  }
  if (latestApplied === null || latestApplied < latestKnown) {
    throw new SeedError("schema_outdated", "The database is behind the app's migrations", "behind");
  }
  if (latestApplied > latestKnown) {
    throw new SeedError("schema_ahead", "The database is ahead of the app's migrations", "ahead");
  }
}

// One transaction: the lock, then the plan from the accounts as they stand, then every account
// disabled and each row upserted as active. Nothing is active while the rows are written, so a
// swap or a handover never meets the one-active-account rules row by row. Then the sessions of
// disabled and reactivated accounts are revoked. drizzle runs a rollback after a failed commit,
// and that rollback's error hides the commit's, hence `bodyFinished`.
async function applyAccountSync(
  connection: DatabaseConnection,
  rows: AccountRow[],
  { now, lockWaitMs }: AccountSeedOptions,
  progress: SeedProgress
): Promise<AccountSyncPlan> {
  return connection.transaction(async (tx) => {
    await lockUserAccountsForSync(tx, { waitMs: lockWaitMs });
    const plan = planAccountSync(await listUserAccounts(tx), rows);
    await deactivateAllUserAccounts(tx);
    for (const row of rows) await upsertUserAccountByEmail(tx, { userId: randomUUID(), ...row });
    await revokeSessionsForUsers(tx, [...plan.disabledUserIds, ...plan.reactivatedUserIds], now);
    progress.bodyFinished = true;
    return plan;
  });
}

// The failure line's code, reason and hint. Never the error itself: drizzle's message carries the
// query's parameters, and Postgres's detail repeats conflicting values.
function failureLine(error: unknown, progress: SeedProgress): LogContext {
  if (error instanceof SeedError) {
    return { code: error.code, reason: error.reason, hint: FAILURE_HINTS[error.code] };
  }
  const reason = describeFailure(error);
  if (progress.bodyFinished) {
    return { code: "database_failure", reason, hint: UNKNOWN_OUTCOME_HINT, outcome: "unknown" };
  }
  return { code: "database_failure", reason, hint: FAILURE_HINTS.database_failure };
}

function reportPlan(
  logger: Logger,
  plan: AccountSyncPlan,
  { target, mode }: { target: string; mode: "dry run" | "applied" }
) {
  for (const { teamId, change } of plan.teams) {
    logger.info("seed.accounts.team", { teamId, change });
  }
  const count = (change: AccountChange) =>
    plan.teams.filter((team) => team.change === change).length;
  logger.info("seed.accounts.summary", {
    target,
    mode,
    created: count("created"),
    updated: count("updated"),
    reactivated: count("reactivated"),
    unchanged: count("unchanged"),
    disabled: plan.disabledUserIds.length,
  });
}

// host:port/database, never the user or the password; undefined for a URL that doesn't parse, or
// whose target isn't plain, since its parts could then hold some of the password.
function targetOf(databaseUrl: string): string | undefined {
  return URL.canParse(databaseUrl) ? plainTarget(new URL(databaseUrl)) : undefined;
}

function plainTarget(url: URL): string | undefined {
  const database = url.pathname.slice(1);
  if (TARGET_PARAMETERS.some((name) => url.searchParams.has(name))) return undefined;
  if (!PLAIN_HOST.test(url.hostname) || !PLAIN_DATABASE.test(database)) return undefined;
  return `${url.hostname}:${url.port || "5432"}/${database}`;
}
