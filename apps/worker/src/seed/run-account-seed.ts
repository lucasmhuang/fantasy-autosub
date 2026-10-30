import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Logger } from "@injurysub/config";
import {
  createDatabaseConnection,
  type DatabaseClient,
  deactivateAllUserAccounts,
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
import { SeedError } from "./errors";

export type AccountSeedOptions = {
  filePath: string;
  apply: boolean;
  databaseUrl: string;
  logger: Logger;
  now: Date;
  connectionTimeoutMs?: number;
};

// Brings a database's accounts in line with the league's accounts file. Unless `apply`, it's a dry
// run: it reports each team's change and writes nothing. An apply makes every change in one
// transaction and reports them once it has committed. Nothing it prints names an email address, a
// display name, or the database's credentials.
export async function runAccountSeed(options: AccountSeedOptions): Promise<{ exitCode: 0 | 1 }> {
  const rows = await readAccountRows(options.filePath);
  const connection = createDatabaseConnection({
    connectionString: options.databaseUrl,
    applicationName: "injurysub-seed",
    maxConnections: 1,
    connectionTimeoutMs: options.connectionTimeoutMs ?? 5_000,
  });
  try {
    const plan = options.apply
      ? await applyAccountSync(connection.db, rows, options.now)
      : planAccountSync(await listUserAccounts(connection.db), rows);
    const mode = options.apply ? "applied" : "dry run";
    reportPlan(options.logger, plan, { target: describeTarget(options.databaseUrl), mode });
    return { exitCode: 0 };
  } finally {
    await connection.close();
  }
}

async function readAccountRows(filePath: string): Promise<AccountRow[]> {
  const result = parseAccountsFile(await readFile(filePath, "utf8"));
  if (!result.ok) throw new SeedError("file_invalid", "The accounts file has problems");
  return result.rows;
}

// One transaction: the lock, then the plan from the accounts as they stand, then every account
// disabled and each row upserted as active. Nothing is active while the rows are written, so a
// swap or a handover never meets the one-active-account rules row by row. Then the sessions of
// disabled and reactivated accounts are revoked.
async function applyAccountSync(
  db: DatabaseClient,
  rows: AccountRow[],
  now: Date
): Promise<AccountSyncPlan> {
  return db.transaction(async (tx) => {
    await lockUserAccountsForSync(tx);
    const plan = planAccountSync(await listUserAccounts(tx), rows);
    await deactivateAllUserAccounts(tx);
    for (const row of rows) await upsertUserAccountByEmail(tx, { userId: randomUUID(), ...row });
    await revokeSessionsForUsers(tx, [...plan.disabledUserIds, ...plan.reactivatedUserIds], now);
    return plan;
  });
}

function reportPlan(
  logger: Logger,
  plan: AccountSyncPlan,
  { target, mode }: { target: string; mode: "dry run" | "applied" }
) {
  for (const { teamId, change } of plan.teams)
    logger.info("seed.accounts.team", { teamId, change });
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

// host:port/database: never the user or the password.
function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
}
