import type { LogLevel } from "./env";

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return error;
}

export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (event: string, context?: LogContext) => void;
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
  error: (event: string, error?: unknown, context?: LogContext) => void;
};

export function createLogger(service: string, minimumLevel: LogLevel = "info"): Logger {
  function shouldLog(level: LogLevel) {
    return levelWeights[level] >= levelWeights[minimumLevel];
  }

  function emit(level: LogLevel, event: string, context: LogContext = {}) {
    if (!shouldLog(level)) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...context,
    };

    const line = JSON.stringify(payload);

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  return {
    debug(event, context) {
      emit("debug", event, context);
    },
    info(event, context) {
      emit("info", event, context);
    },
    warn(event, context) {
      emit("warn", event, context);
    },
    error(event, error, context = {}) {
      emit("error", event, {
        ...context,
        error: serializeError(error),
      });
    },
  };
}
