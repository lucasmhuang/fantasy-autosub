import { setTimeout as sleep } from "node:timers/promises";
import { createLogger, loadServerEnv } from "@injurysub/config";
import { type DatabaseConnection, readMigrationState } from "@injurysub/db";
import { executionModes } from "@injurysub/domain";
import { createEmailClient } from "@injurysub/email";
import { loadRecordingCapturedAt, probeEspnReachability } from "@injurysub/espn";
import { createWorkerDatabaseConnection } from "./db";
import { createWorkerEspnClient } from "./espn-client";
import { refuseRecordedEspnWhenHosted, waitForMigrations } from "./espn-startup";
import { createWorkerRuntimeState } from "./health";
import { startWorkerHttpServer } from "./http-server";
import { createStartupReconciliationLoop, createSweepLoop } from "./loops/runtime";

const env = loadServerEnv();
const logger = createLogger("worker", env.LOG_LEVEL);
const runtimeState = createWorkerRuntimeState(env.WORKER_SWEEP_INTERVAL_MS);

const emailClient = createEmailClient({
  mode: env.EMAIL_DELIVERY_MODE,
  fromAddress: env.EMAIL_FROM_ADDRESS,
  resendApiKey: env.RESEND_API_KEY,
});

// The migration check retries every 10 s for up to 5 minutes while web's pre-deploy migrates.
const MIGRATION_CHECK_INTERVAL_MS = 10_000;
const MIGRATION_CHECK_ATTEMPTS = 30;

async function main() {
  refuseRecordedEspnWhenHosted(env);
  const espnClient = createWorkerEspnClient(env);
  // In stub mode, how old the recorded league is: a local file, so no ESPN call.
  const espnRecordedAt = espnClient.mode === "stub" ? await loadRecordingCapturedAt() : undefined;
  const database = createWorkerDatabaseConnection(env.DATABASE_URL, logger);

  // The server starts first, answering 503 on /health until the database is at this version's
  // migrations, so Railway keeps the previous worker serving until then.
  let ready = false;
  const httpServer = startWorkerHttpServer({
    port: env.WORKER_HEALTH_PORT,
    runtimeState,
    logger,
    dependencyChecks: [{ name: "database", check: () => database.check() }],
    isReady: () => ready,
    espn: espnClient,
    internalToken: env.WORKER_INTERNAL_TOKEN,
  });
  registerShutdown(database, () => database.close(), httpServer.close.bind(httpServer));

  await waitForMigrations({
    readState: () => readMigrationState(database.db),
    logger,
    sleep: () => sleep(MIGRATION_CHECK_INTERVAL_MS),
    attempts: MIGRATION_CHECK_ATTEMPTS,
  });
  ready = true;
  logWorkerStart(espnClient.mode, espnRecordedAt);
  if (espnClient.mode === "none") void logEspnReachability();

  const sweep = createSweepLoop({
    intervalMs: env.WORKER_SWEEP_INTERVAL_MS,
    logger,
    runtimeState,
  });
  const reconciliation = createStartupReconciliationLoop({
    logger,
    runtimeState,
  });

  await reconciliation();
  sweep();
}

// Without the cookie, whether ESPN answers this host at all (Dec-D11): a JSON 401 means it does.
async function logEspnReachability() {
  const results = await probeEspnReachability({ season: env.SEASON_YEAR, leagueId: env.LEAGUE_ID });
  for (const result of results) logger.info("worker.espn.reachability", result);
}

function logWorkerStart(espnMode: string, espnRecordedAt: string | undefined) {
  logger.info("worker.start", {
    appBaseUrl: env.APP_BASE_URL,
    databaseUrlConfigured: Boolean(env.DATABASE_URL),
    emailMode: emailClient.mode,
    espnMode,
    espnRecordedAt,
    executionModes,
    workerHealthPort: env.WORKER_HEALTH_PORT,
    workerSweepIntervalMs: env.WORKER_SWEEP_INTERVAL_MS,
  });
}

function registerShutdown(
  database: DatabaseConnection,
  closeDatabase: () => Promise<void>,
  closeHealthServer: (callback: (error?: Error) => void) => void
) {
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info("worker.shutdown", {
      signal,
    });

    try {
      closeHealthServer((error?: Error) => {
        if (error) {
          logger.error("worker.health.close_failed", error);
        }
      });
      await closeDatabase();
    } catch (error) {
      logger.error("worker.shutdown_failed", error, {
        hasDatabasePool: Boolean(database.pool),
      });
      process.exit(1);
    }

    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  logger.error("worker.fatal", error);
  process.exit(1);
});
