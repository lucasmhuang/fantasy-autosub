import { loadServerEnv } from "@injurysub/config";
import { executionModes } from "@injurysub/domain";
import {
  createStartupReconciliationLoop,
  createSweepLoop
} from "./loops/runtime";

const env = loadServerEnv();

async function main() {
  console.log("injurysub-worker:start", {
    appBaseUrl: env.APP_BASE_URL,
    executionModes
  });

  const sweep = createSweepLoop();
  const reconciliation = createStartupReconciliationLoop();

  await reconciliation();
  sweep();
}

void main().catch((error) => {
  console.error("injurysub-worker:fatal", error);
  process.exit(1);
});

