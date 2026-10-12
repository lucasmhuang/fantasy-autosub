import type { LogLevel } from "./env";

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Identifying fields beyond message/name/stack; an allowlist, so arbitrary error data stays out of logs.
const errorDetailKeys = ["code", "status", "statusCode"] as const;
const maxCauseDepth = 5;

function serializeError(
  error: unknown,
  ancestors: ReadonlySet<Error> = new Set(),
  depth = 0
): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  if (ancestors.has(error)) {
    return "[Circular]";
  }

  const serialized: Record<string, unknown> = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };

  for (const key of errorDetailKeys) {
    const value: unknown = Reflect.get(error, key);
    if (value !== undefined) {
      serialized[key] = value;
    }
  }

  if (error.cause !== undefined) {
    serialized.cause =
      depth < maxCauseDepth
        ? serializeError(error.cause, new Set([...ancestors, error]), depth + 1)
        : "[Truncated]";
  }

  return serialized;
}

// Marks only true cycles (an object nested inside itself), so a shared reference still serializes in full.
function createLineReplacer() {
  const ancestors: unknown[] = [];

  return function replaceUnserializable(this: unknown, _key: string, value: unknown) {
    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    while (ancestors.length > 0 && ancestors.at(-1) !== this) {
      ancestors.pop();
    }

    if (ancestors.includes(value)) {
      return "[Circular]";
    }

    ancestors.push(value);
    return value;
  };
}

function stringifyPayload(
  payload: Record<string, unknown> & {
    timestamp: string;
    level: LogLevel;
    service: string;
    event: string;
  }
) {
  try {
    return JSON.stringify(payload, createLineReplacer());
  } catch (serializationError) {
    // A TypeError means the payload holds something JSON cannot represent; still record the event.
    if (!(serializationError instanceof TypeError)) {
      throw serializationError;
    }

    const { timestamp, level, service, event } = payload;
    return JSON.stringify({
      timestamp,
      level,
      service,
      event,
      logSerializationError: serializationError.message,
    });
  }
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

    const line = stringifyPayload(payload);

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
