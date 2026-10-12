import { createLogger, type Logger, loadServerEnv } from "@injurysub/config";

declare global {
  var __injurysubWebLogger: Logger | undefined;
}

export function getWebLogger(): Logger {
  if (globalThis.__injurysubWebLogger) {
    return globalThis.__injurysubWebLogger;
  }

  const logger = createLogger("web", loadServerEnv().LOG_LEVEL);

  globalThis.__injurysubWebLogger = logger;

  return logger;
}
