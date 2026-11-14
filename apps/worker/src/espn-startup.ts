import { type Logger, resolveAppEnvironment, type ServerEnv } from "@injurysub/config";
import { describeFailure, isDatabaseQueryError, type MigrationState } from "@injurysub/db";
import { WorkerStartupError } from "./startup-error";

// Recorded or scripted ESPN data never serves the real league: production reads live ESPN, or
// none at all until the cookie is set. Staging, which never sends, may read either.
export function refuseRecordedEspnInProduction(env: ServerEnv): void {
  if (resolveAppEnvironment(env) !== "production") return;
  if (env.ESPN_MODE === "stub" || env.ESPN_MODE === "scripted") {
    throw new WorkerStartupError("ESPN_MODE must be live or none in production.");
  }
}

type MigrationCheck = "current" | "ahead" | { behind: string };

async function checkMigrations(readState: () => Promise<MigrationState>): Promise<MigrationCheck> {
  try {
    const { hasAccountsTable, latestApplied, latestKnown } = await readState();
    if (!hasAccountsTable || latestApplied === null || latestApplied < latestKnown) {
      return { behind: "behind" };
    }
    return latestApplied > latestKnown ? "ahead" : "current";
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    return { behind: describeFailure(error) };
  }
}

// Waits for the database to reach this version's migrations: web's pre-deploy command migrates
// it while the new worker may already be starting. A database a newer version migrated is fine,
// since every migration keeps the version before it working (a rollback). Gives up after
// `attempts` checks, `sleep` apart.
export async function waitForMigrations(input: {
  readState: () => Promise<MigrationState>;
  logger: Logger;
  sleep: () => Promise<void>;
  attempts: number;
}): Promise<void> {
  const { logger, attempts } = input;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const check = await checkMigrations(input.readState);
    if (check === "current") return;
    if (check === "ahead") {
      logger.warn("worker.migrations.ahead", {});
      return;
    }
    logger.warn("worker.migrations.waiting", { attempt, attempts, reason: check.behind });
    if (attempt < attempts) await input.sleep();
  }
  throw new WorkerStartupError("The database isn't at this version's migrations: gave up waiting.");
}
