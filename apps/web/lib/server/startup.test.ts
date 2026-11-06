import { afterEach, describe, expect, it, vi } from "vitest";
import { StartupConfigError, stopOnInvalidEnvironment, validateWebEnvironment } from "./startup";

// Invented values only.
const hostedSettings = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app@db.internal.example:5432/injurysub?sslmode=no-verify",
  APP_BASE_URL: "https://injurysub.example",
  SESSION_SECRET: "s".repeat(48),
  EMAIL_DELIVERY_MODE: "resend",
  RESEND_API_KEY: "re_invented_key",
  EMAIL_FROM_ADDRESS: "signin@mail.injurysub.example",
  WORKER_INTERNAL_TOKEN: "t".repeat(64),
};

const badSettings = {
  ...hostedSettings,
  SESSION_SECRET: "a-distinctive-short-secret",
  EMAIL_DELIVERY_MODE: "console",
};

class ExitCalled extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${code})`);
  }
}

function captureConsoleError() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => spy.mock.calls.map((call) => String(call[0]));
}

function thrownBy(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("expected it to throw");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateWebEnvironment", () => {
  it("accepts a hosted deployment's real settings", () => {
    const errorLines = captureConsoleError();

    expect(() => validateWebEnvironment(hostedSettings)).not.toThrow();
    expect(errorLines()).toEqual([]);
  });

  it("refuses bad settings, logging each one's name and never a value", () => {
    const errorLines = captureConsoleError();

    const failure = thrownBy(() => validateWebEnvironment(badSettings));

    expect(failure).toBeInstanceOf(StartupConfigError);
    expect(failure).toMatchObject({ code: "invalid_env" });
    const lines = errorLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      service: "web",
      event: "web.startup.invalid_env",
      settings: ["SESSION_SECRET", "EMAIL_DELIVERY_MODE"],
    });
    expect(lines[0]).not.toContain("a-distinctive-short-secret");
    expect(String(failure)).not.toContain("a-distinctive-short-secret");
  });
});

// A throw from instrumentation's register() would leave `next start` serving 500s, so it exits.
describe("stopOnInvalidEnvironment", () => {
  it("exits with code 1 on bad settings", () => {
    captureConsoleError();
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitCalled(code);
    });

    expect(thrownBy(() => stopOnInvalidEnvironment(badSettings))).toMatchObject({ code: 1 });
  });

  it("carries on with real settings", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitCalled(code);
    });

    stopOnInvalidEnvironment(hostedSettings);

    expect(exit).not.toHaveBeenCalled();
  });
});
