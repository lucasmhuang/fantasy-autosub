import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createLogger, loadServerEnv } from "@injurysub/config";
import { type DatabaseConnection, readMigrationState } from "@injurysub/db";
import { executionModes } from "@injurysub/domain";
import { createEmailClient } from "@injurysub/email";
import { loadRecordingCapturedAt, probeEspnReachability } from "@injurysub/espn";
import { createWorkerDatabaseConnection } from "./db";
import { createWorkerEspnClient } from "./espn-client";
import { refuseRecordedEspnWhenHosted, waitForMigrations } from "./espn-startup";
import { sweepWaitingRequests, type WeekSource } from "./expiry";
import { createWorkerRuntimeState } from "./health";
import { startWorkerHttpServer } from "./http-server";
import { createScheduler, type Scheduler } from "./loops/scheduler";
import { sendPendingEmails } from "./outbox";

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
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;

async function main() {
  refuseRecordedEspnWhenHosted(env);
  const espnClient = createWorkerEspnClient(env);
  // In stub mode, how old the recorded league is: a local file, so no ESPN call.
  const espnRecordedAt = espnClient.mode === "stub" ? await loadRecordingCapturedAt() : undefined;
  const database = createWorkerDatabaseConnection(env.DATABASE_URL, logger);

  // The server starts first, answering 503 on /health until the database is at this version's
  // migrations, so Railway keeps the previous worker serving until then.
  const readiness = { ready: false };
  const httpServer = startWorkerHttpServer({
    port: env.WORKER_HEALTH_PORT,
    runtimeState,
    logger,
    dependencyChecks: [{ name: "database", check: () => database.check() }],
    isReady: () => readiness.ready,
    espn: espnClient,
    internalToken: env.WORKER_INTERNAL_TOKEN,
  });
  const schedulers = createSweepSchedulers(database, espnClient);
  registerShutdown({ schedulers, httpServer, database });

  await waitForMigrations({
    readState: () => readMigrationState(database.db),
    logger,
    sleep: () => sleep(MIGRATION_CHECK_INTERVAL_MS),
    attempts: MIGRATION_CHECK_ATTEMPTS,
  });
  readiness.ready = true;
  logWorkerStart(espnClient.mode, espnRecordedAt);
  if (espnClient.mode === "none") void logEspnReachability();
  for (const scheduler of schedulers) scheduler.start();
}

// The commissioner's emails go out every sweep. Waiting requests are checked every minute: the
// matchup check reads ESPN while anything waits, and a minute's precision is enough for it.
function createSweepSchedulers(database: DatabaseConnection, espn: WeekSource): Scheduler[] {
  const outbox = createScheduler({
    intervalMs: env.WORKER_SWEEP_INTERVAL_MS,
    logger,
    tasks: [
      {
        name: "outbox",
        run: () =>
          sendPendingEmails({ db: database.db, email: emailClient, logger, now: new Date() }),
      },
      { name: "mark_sweep", run: async () => runtimeState.markSweep() },
    ],
  });
  const expiry = createScheduler({
    intervalMs: EXPIRY_SWEEP_INTERVAL_MS,
    logger,
    tasks: [
      {
        name: "expiry",
        run: () => sweepWaitingRequests({ connection: database, espn, logger, now: new Date() }),
      },
    ],
  });
  return [outbox, expiry];
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

// Stops the sweeps first, letting a run in progress finish, then the server, then the pool.
function registerShutdown(running: {
  schedulers: Scheduler[];
  httpServer: Server;
  database: DatabaseConnection;
}) {
  let isShuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("worker.shutdown", { signal });
    try {
      await Promise.all(running.schedulers.map((scheduler) => scheduler.stop()));
      await new Promise<void>((resolve, reject) => {
        running.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await running.database.close();
    } catch (error) {
      logger.error("worker.shutdown_failed", error);
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
