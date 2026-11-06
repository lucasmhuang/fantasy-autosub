import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLogger } from "@injurysub/config";
import { buildScenarioFiles } from "@injurysub/espn";

// Writes the scripted ESPN scenarios from the committed recordings. Run it through the root
// `pnpm scenarios:build`, which formats the files and runs the scenarios test afterwards. It
// reads no settings and reaches no network.
const logger = createLogger("scenarios");

async function main() {
  const scenariosDir = process.argv[2];
  if (!scenariosDir) {
    logger.error("scenarios.build.misconfigured", undefined, { scenariosDirGiven: false });
    process.exit(1);
  }
  const files = await buildScenarioFiles();
  const dir = resolve(scenariosDir);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  logger.info("scenarios.build.written", { fileCount: Object.keys(files).length });
}

void main().catch((error) => {
  logger.error("scenarios.build.failed", error);
  process.exit(1);
});
