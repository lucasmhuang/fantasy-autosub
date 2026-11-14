import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createLogger, loadServerEnv, resolveAppEnvironment } from "@injurysub/config";
import { type DatabaseConnection, readMigrationState } from "@injurysub/db";
import { leagueExecutionModes } from "@injurysub/domain";
import { createEmailClient } from "@injurysub/email";
import {
  createEspnMonitoringClient,
  type EspnClient,
  type EspnMonitoringClient,
  loadRecordingCapturedAt,
  probeEspnReachability,
} from "@injurysub/espn";
import { createWorkerDatabaseConnection } from "./db";
import { createWorkerEspnClient, createWorkerWriteClient, workerSendMode } from "./espn-client";
import { refuseRecordedEspnInProduction, waitForMigrations } from "./espn-startup";
import { executorTasks, runExecutorPass } from "./executor/executor";
import { sweepWaitingRequests } from "./expiry";
import { createWorkerRuntimeState } from "./health";
import { heartbeatTask } from "./heartbeat";
import { startWorkerHttpServer } from "./http-server";
import { createScheduler, type Scheduler } from "./loops/scheduler";
import { detectionTasks, runDetectionPass } from "./monitor/detection";
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
// Misuse detection reads the league every few minutes (OQ18).
const DETECTION_INTERVAL_MS = 5 * 60_000;
// This worker's name as the ESPN-write lease's holder: two workers overlap during a deploy.
const LEASE_HOLDER = `worker-${randomUUID()}`;
const WORKER_STARTED_AT = new Date();

async function main() {
  refuseRecordedEspnInProduction(env);
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
  return [
    outbox,
    expiry,
    createExecutorScheduler(database, espn),
    createDetectionScheduler(database, espn),
  ];
}

// Misuse detection, where ESPN is read live with the cookie (C4). One monitoring client for the
// worker's life, so its season check keeps its answer for the day.
function createDetectionScheduler(database: DatabaseConnection, espn: EspnClient): Scheduler {
  const monitor = createWorkerMonitoringClient();
  const run = async () => {
    if (monitor === null) return;
    await runDetectionPass({ connection: database, espn, monitor, now: new Date(), logger });
  };
  return createScheduler({
    intervalMs: DETECTION_INTERVAL_MS,
    logger,
    tasks: detectionTasks({ mode: espn.mode, run }),
  });
}

// The live settings require the cookie and the league; null elsewhere, where detection isn't run.
function createWorkerMonitoringClient(): EspnMonitoringClient | null {
  const { ESPN_MODE, ESPN_S2, ESPN_SWID, LEAGUE_ID, SEASON_YEAR } = env;
  if (ESPN_MODE !== "live" || !ESPN_S2 || !ESPN_SWID || LEAGUE_ID === undefined) return null;
  return createEspnMonitoringClient({
    season: SEASON_YEAR,
    leagueId: LEAGUE_ID,
    credentials: { espnS2: ESPN_S2, swid: ESPN_SWID },
  });
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
  const beat = heartbeatTask({
    db: database.db,
    workerId: LEASE_HOLDER,
    startedAt: WORKER_STARTED_AT,
    clock: () => new Date(),
  });
  return createScheduler({
    intervalMs: env.WORKER_SWEEP_INTERVAL_MS,
    logger,
    tasks: executorTasks({ mode: espn.mode, run, beat }),
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
    appEnvironment: resolveAppEnvironment(env),
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
