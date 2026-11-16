import { createLogger, loadServerEnv, type ServerEnv } from "@injurysub/config";
import { runPracticeReset } from "./practice-reset";

// Empties a practice database's requests so staging's walk can start again: run it as
// `pnpm practice:reset [--apply]` against DATABASE_URL (from the shell, .env.local or .env). It's a
// dry run unless --apply. A failure before it starts logs only the error's name, since an error's
// text could hold a value.
async function main() {
  let env: ServerEnv;
  try {
    env = loadServerEnv();
  } catch (error) {
    logStartFailure("env_invalid", error);
    return;
  }
  const logger = createLogger("practice", env.LOG_LEVEL);
  const args = process.argv.slice(2);
  const apply = args.length === 1 && args[0] === "--apply";
  if (args.length > 0 && !apply) {
    logger.error("practice.reset.misconfigured", undefined, { argCount: args.length });
    process.exitCode = 1;
    return;
  }
  const { exitCode } = await runPracticeReset({
    apply,
    databaseUrl: env.DATABASE_URL,
    logger,
    now: new Date(),
  });
  process.exitCode = exitCode;
}

function logStartFailure(code: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  createLogger("practice").error("practice.reset.failed", undefined, { code, name });
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  logStartFailure("unexpected", error);
});
