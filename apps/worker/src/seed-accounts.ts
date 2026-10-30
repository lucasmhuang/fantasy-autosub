import { createLogger, loadServerEnv, type ServerEnv } from "@injurysub/config";
import { parseSeedArguments } from "./seed/arguments";
import { runAccountSeed } from "./seed/run-account-seed";

// Seeds the league's accounts into DATABASE_URL (from the shell, .env.local or .env): run it as
// `pnpm seed:accounts <absolute path to the accounts file> [--apply]`. It's a dry run unless
// --apply. It prints no address, name or credential: runAccountSeed logs its own failures, and a
// failure before it starts logs only the error's name, since an error's text could hold a value.
async function main() {
  let env: ServerEnv;
  try {
    env = loadServerEnv();
  } catch (error) {
    logStartFailure("env_invalid", error);
    return;
  }
  const logger = createLogger("seed", env.LOG_LEVEL);
  const args = parseSeedArguments(process.argv.slice(2));
  if (!args.ok) {
    const { pathGiven, unknownArgCount } = args;
    logger.error("seed.accounts.misconfigured", undefined, { pathGiven, unknownArgCount });
    process.exitCode = 1;
    return;
  }
  const { exitCode } = await runAccountSeed({
    filePath: args.filePath,
    apply: args.apply,
    databaseUrl: env.DATABASE_URL,
    logger,
    now: new Date(),
  });
  process.exitCode = exitCode;
}

function logStartFailure(code: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  createLogger("seed").error("seed.accounts.failed", undefined, { code, name });
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  logStartFailure("unexpected", error);
});
