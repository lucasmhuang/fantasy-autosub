import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createLogger, loadServerEnv } from "@injurysub/config";
import { type DatabaseConnection, readMigrationState } from "@injurysub/db";
import { leagueExecutionModes } from "@injurysub/domain";
import { createEmailClient } from "@injurysub/email";
import { type EspnClient, loadRecordingCapturedAt, probeEspnReachability } from "@injurysub/espn";
import { createWorkerDatabaseConnection } from "./db";
import { createWorkerEspnClient, createWorkerWriteClient, workerSendMode } from "./espn-client";
import { refuseRecordedEspnWhenHosted, waitForMigrations } from "./espn-startup";
import { executorTasks, runExecutorPass } from "./executor/executor";
import { sweepWaitingRequests } from "./expiry";
import { createWorkerRuntimeState } from "./health";
import { startWorkerHttpServer } from "./http-server";
import { createScheduler, type Scheduler } from "./loops/scheduler";
import { sendPendingEmails } from "./outbox";
import { stopWorker } from "./shutdown";

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
// This worker's name as the ESPN-write lease's holder: two workers overlap during a deploy.
const LEASE_HOLDER = `worker-${randomUUID()}`;

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
    sendMode: workerSendMode(env),
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
function createSweepSchedulers(database: DatabaseConnection, espn: EspnClient): Scheduler[] {
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
  return [outbox, expiry, createExecutorScheduler(database, espn)];
}

// The executor takes one queued request a sweep, under the ESPN-write lease. Its write client
// sends only while ESPN_SEND_MODE is live; otherwise each run is a rehearsal.
function createExecutorScheduler(database: DatabaseConnection, espn: EspnClient): Scheduler {
  const write = createWorkerWriteClient(env);
  const run = async () => {
    const result = await runExecutorPass({
      connection: database,
      espn,
      write,
      holder: LEASE_HOLDER,
      now: new Date(),
      clock: () => new Date(),
      sleep: (ms) => sleep(ms),
      logger,
    });
    if (result.kind !== "idle") logger.info("worker.executor.pass", { result: result.kind });
  };
  return createScheduler({
    intervalMs: env.WORKER_SWEEP_INTERVAL_MS,
    logger,
    tasks: executorTasks({ mode: espn.mode, run }),
  });
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
    espnSendMode: workerSendMode(env),
    leagueExecutionModes,
    workerHealthPort: env.WORKER_HEALTH_PORT,
    workerSweepIntervalMs: env.WORKER_SWEEP_INTERVAL_MS,
  });
}

// On SIGINT or SIGTERM, stops the worker at a step boundary (stopWorker), then exits.
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
      await stopWorker(running);
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
