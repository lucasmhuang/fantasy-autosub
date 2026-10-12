import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

type LogEntry = Record<string, unknown> & {
  error?: Record<string, unknown> & { cause?: unknown };
};

function captureConsole(method: "error" | "log") {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});

  return () => spy.mock.calls.map((call) => String(call[0]));
}

function onlyEntry(lines: string[]): LogEntry {
  expect(lines).toHaveLength(1);

  return JSON.parse(lines[0] ?? "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("includes the cause of a logged error", () => {
    const lines = captureConsole("error");

    createLogger("test").error("test.failed", new Error("outer", { cause: new Error("inner") }));

    const entry = onlyEntry(lines());
    expect(entry.error?.message).toBe("outer");
    expect(entry.error?.cause).toMatchObject({ message: "inner", name: "Error" });
  });

  it("includes the code a database error carries", () => {
    const lines = captureConsole("error");
    const databaseError = Object.assign(new Error('database "injurysub" does not exist'), {
      code: "3D000",
    });

    createLogger("worker").error(
      "worker.fatal",
      new Error("Failed query: select 1", { cause: databaseError })
    );

    expect(onlyEntry(lines()).error?.cause).toMatchObject({
      message: 'database "injurysub" does not exist',
      code: "3D000",
    });
  });

  it("keeps a plain-object cause in full", () => {
    const lines = captureConsole("error");
    const providerError = { name: "validation_error", statusCode: 422, message: "Invalid from" };

    createLogger("test").error("test.failed", new Error("send failed", { cause: providerError }));

    expect(onlyEntry(lines()).error?.cause).toEqual(providerError);
  });

  it("keeps a cause that is also logged in the context", () => {
    const lines = captureConsole("error");
    const provider = { name: "validation_error", statusCode: 403, message: "Not verified" };

    createLogger("test").error("test.failed", new Error("send failed", { cause: provider }), {
      provider,
    });

    const entry = onlyEntry(lines());
    expect(entry.provider).toEqual(provider);
    expect(entry.error?.cause).toEqual(provider);
  });

  it("cuts a cause chain that loops back instead of repeating it", () => {
    const lines = captureConsole("error");
    const looping = new Error("loop");
    looping.cause = looping;

    createLogger("test").error("test.failed", looping);

    const [line] = lines();
    expect(onlyEntry(lines()).error?.cause).toBe("[Circular]");
    expect(line?.match(/"stack"/g)).toHaveLength(1);
  });

  it("truncates a very deep cause chain", () => {
    const lines = captureConsole("error");
    let deepest = new Error("level 0");
    for (let level = 1; level < 1000; level += 1) {
      deepest = new Error(`level ${level}`, { cause: deepest });
    }

    createLogger("test").error("test.failed", deepest);

    let serializedLevels = 0;
    let current: unknown = onlyEntry(lines()).error;
    while (typeof current === "object" && current !== null) {
      serializedLevels += 1;
      current = (current as { cause?: unknown }).cause;
    }
    expect(serializedLevels).toBe(6);
    expect(current).toBe("[Truncated]");
  });

  it("writes a cause object that contains itself without throwing", () => {
    const lines = captureConsole("error");
    const selfContaining: Record<string, unknown> = { name: "loop" };
    selfContaining.self = selfContaining;

    createLogger("test").error("test.failed", new Error("outer", { cause: selfContaining }));

    expect(onlyEntry(lines()).error?.cause).toEqual({ name: "loop", self: "[Circular]" });
  });

  it("writes bigint values as strings", () => {
    const lines = captureConsole("log");

    createLogger("test").info("test.counted", { rows: 10n });

    expect(onlyEntry(lines()).rows).toBe("10");
  });

  it("writes a fallback entry when the payload cannot be serialized", () => {
    const lines = captureConsole("log");
    const unserializable = {
      toJSON() {
        throw new TypeError("cannot serialize");
      },
    };

    createLogger("test").info("test.weird", { unserializable });

    expect(onlyEntry(lines())).toMatchObject({
      event: "test.weird",
      level: "info",
      service: "test",
      logSerializationError: "cannot serialize",
    });
  });

  it("lets other serialization errors propagate", () => {
    captureConsole("log");
    const exploding = {
      toJSON() {
        throw new Error("boom");
      },
    };

    expect(() => createLogger("test").info("test.weird", { exploding })).toThrow("boom");
  });
});
