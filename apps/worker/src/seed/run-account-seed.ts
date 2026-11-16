import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { LogContext, Logger } from "@injurysub/config";
import {
  type DatabaseConnection,
  deactivateAllUserAccounts,
  describeFailure,
  listUserAccounts,
  lockUserAccountsForSync,
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
import {
  openConnection,
  requireCurrentSchema,
  requireEncryptionSetting,
  requireReachable,
  requireSupportedUrl,
  targetOf,
} from "./database";
import { SeedError } from "./errors";
import { FAILURE_HINTS, UNKNOWN_OUTCOME_HINT } from "./failure";

export type AccountSeedOptions = {
  filePath: string;
  apply: boolean;
  databaseUrl: string;
  logger: Logger;
  now: Date;
  connectionTimeoutMs?: number;
  // How long one statement may take before the seed gives up on it: the call fails on this side,
  // while the server may still finish the statement.
  queryTimeoutMs?: number;
  lockWaitMs?: number;
};

// Whether the apply's transaction body finished, so that a failure came at or after its commit.
type SeedProgress = { bodyFinished: boolean };

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
  const connection = openConnection({ ...options, applicationName: "injurysub-seed" });
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
