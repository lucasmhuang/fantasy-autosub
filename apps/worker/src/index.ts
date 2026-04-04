import { createLogger, loadServerEnv } from "@injurysub/config";
import { executionModes } from "@injurysub/domain";
import { createEmailClient } from "@injurysub/email";
import { createEspnClient } from "@injurysub/espn";
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
  startWorkerHealthServer(env.WORKER_HEALTH_PORT, runtimeState, logger);

  logger.info("worker.start", {
    appBaseUrl: env.APP_BASE_URL,
    emailMode: emailClient.mode,
    espnMode: espnClient.mode,
    executionModes,
    workerHealthPort: env.WORKER_HEALTH_PORT,
    workerSweepIntervalMs: env.WORKER_SWEEP_INTERVAL_MS,
  });

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

void main().catch((error) => {
  logger.error("worker.fatal", error);
  process.exit(1);
});
