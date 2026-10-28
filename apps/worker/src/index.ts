import { createLogger, loadServerEnv } from "@injurysub/config";
import { type DatabaseConnection } from "@injurysub/db";
import { executionModes } from "@injurysub/domain";
import { createEmailClient } from "@injurysub/email";
import { createEspnClient, loadRecordingCapturedAt } from "@injurysub/espn";
import { createWorkerDatabaseConnection } from "./db";
import { createWorkerRuntimeState, startWorkerHealthServer } from "./health";
import { createStartupReconciliationLoop, createSweepLoop } from "./loops/runtime";

const env = loadServerEnv();
const logger = createLogger("worker", env.LOG_LEVEL);
const runtimeState = createWorkerRuntimeState(env.WORKER_SWEEP_INTERVAL_MS);

const emailClient = createEmailClient({
  mode: env.EMAIL_DELIVERY_MODE,
  fromAddress: env.EMAIL_FROM_ADDRESS,
  resendApiKey: env.RESEND_API_KEY,
});

const espnClient =
  env.ESPN_MODE === "stub"
    ? createEspnClient({
        mode: "stub",
      })
    : createEspnClient({
        mode: "live",
        espnS2: env.ESPN_S2!,
        espnSwid: env.ESPN_SWID!,
        leagueId: env.LEAGUE_ID!,
        seasonYear: env.SEASON_YEAR,
      });

async function main() {
  // In stub mode, how old the recorded league is: a local file, so no ESPN call.
  const espnRecordedAt = espnClient.mode === "stub" ? await loadRecordingCapturedAt() : undefined;
  const database = createWorkerDatabaseConnection();
  await database.check();

  const healthServer = startWorkerHealthServer(env.WORKER_HEALTH_PORT, runtimeState, logger, [
    {
      name: "database",
      check: () => database.check(),
    },
  ]);

  const closeDatabase = async () => {
    await database.close();
  };

  registerShutdown(database, closeDatabase, healthServer.close.bind(healthServer));

  logWorkerStart(espnRecordedAt);

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

function logWorkerStart(espnRecordedAt: string | undefined) {
  logger.info("worker.start", {
    appBaseUrl: env.APP_BASE_URL,
    databaseUrlConfigured: Boolean(env.DATABASE_URL),
    emailMode: emailClient.mode,
    espnMode: espnClient.mode,
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
