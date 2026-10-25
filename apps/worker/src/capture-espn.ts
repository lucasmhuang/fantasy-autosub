import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLogger, loadServerEnv } from "@injurysub/config";
import { captureRecordings } from "@injurysub/espn";

// Captures the live ESPN league into the committed recordings, read-only. Run it through the root
// `pnpm capture:espn`, which formats the files and runs the recordings test afterwards. It needs
// ESPN_S2, ESPN_SWID and LEAGUE_ID whatever ESPN_MODE says, and it logs counts only.
const env = loadServerEnv();
const logger = createLogger("capture", env.LOG_LEVEL);

async function main() {
  const recordingsDir = process.argv[2];
  const { ESPN_S2, ESPN_SWID, LEAGUE_ID } = env;
  if (!recordingsDir || !ESPN_S2 || !ESPN_SWID || !LEAGUE_ID) {
    logger.error("capture.espn.misconfigured", undefined, {
      recordingsDirGiven: Boolean(recordingsDir),
      missingSettings: [
        ...(ESPN_S2 ? [] : ["ESPN_S2"]),
        ...(ESPN_SWID ? [] : ["ESPN_SWID"]),
        ...(LEAGUE_ID ? [] : ["LEAGUE_ID"]),
      ],
    });
    process.exit(1);
  }

  const { files, summary } = await captureRecordings({
    season: env.SEASON_YEAR,
    leagueId: LEAGUE_ID,
    credentials: { espnS2: ESPN_S2, swid: ESPN_SWID },
  });
  const dir = resolve(recordingsDir);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  logger.info("capture.espn.written", { fileCount: Object.keys(files).length, ...summary });
}

void main().catch((error) => {
  logger.error("capture.espn.failed", error);
  process.exit(1);
});
