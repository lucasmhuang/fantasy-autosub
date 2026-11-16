import { type Logger, resolveAppEnvironment, type ServerEnv } from "@injurysub/config";
import {
  type DatabaseExecutor,
  describeFailure,
  isDatabaseQueryError,
  type MigrationState,
  markEmptyDatabasePractice,
  readPracticeSince,
} from "@injurysub/db";
import { WorkerStartupError } from "./startup-error";

// Recorded, scripted or practice ESPN data never serves the real league: production reads live
// ESPN, or none at all until the cookie is set. Staging, which never sends to ESPN, may read any.
export function refuseRecordedEspnInProduction(env: ServerEnv): void {
  if (resolveAppEnvironment(env) !== "production") return;
  if (env.ESPN_MODE === "stub" || env.ESPN_MODE === "scripted" || env.ESPN_MODE === "practice") {
    throw new WorkerStartupError("ESPN_MODE must be live or none in production.");
  }
}

// A database is a practice one or a real one, never both, so no request filed against a practice
// copy of ESPN can meet a worker that sends to the real league. A practice worker starts only on a
// practice database, or on one that never held a request, which it marks; a worker sending to the
// real league never starts on a practice database. Other workers send nothing, so either will do.
export async function checkPracticeDatabase(input: {
  db: DatabaseExecutor;
  env: ServerEnv;
  now: Date;
}): Promise<void> {
  const { db, env, now } = input;
  if (env.ESPN_MODE === "practice") {
    if ((await markEmptyDatabasePractice(db, now)) !== null) return;
    throw new WorkerStartupError(
      "ESPN_MODE is practice, but this database holds requests and isn't a practice one: empty it with pnpm practice:reset first."
    );
  }
  if (!sendsToRealLeague(env)) return;
  if ((await readPracticeSince(db)) === null) return;
  throw new WorkerStartupError(
    "ESPN_SEND_MODE is live, but this is a practice database: a worker sending to the real league never runs on one."
  );
}

function sendsToRealLeague(env: ServerEnv): boolean {
  return env.ESPN_MODE === "live" && env.ESPN_SEND_MODE === "live";
}

// The same rule while the worker runs: the mark can be set after it started (a reset run over a
// tunnel, a restore), so a worker sending to the real league checks it in each executor pass, under
// the ESPN-write lease (which the reset holds while it marks), and works no pass while it's set,
// saying so once. Null for a worker that sends nothing to the real league.
export function createLivePassGuard(
  env: ServerEnv,
  logger: Logger
): ((db: DatabaseExecutor) => Promise<boolean>) | null {
  if (!sendsToRealLeague(env)) return null;
  let refusing = false;
  return async (db) => {
    const practiceSince = await readPracticeSince(db);
    if (practiceSince === null) {
      refusing = false;
      return true;
    }
    if (!refusing) {
      logger.error("worker.practice.live_worker_refused", undefined, {
        practiceSince: practiceSince.toISOString(),
      });
    }
    refusing = true;
    return false;
  };
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
