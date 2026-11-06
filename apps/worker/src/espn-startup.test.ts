import { createLogger, loadServerEnv } from "@injurysub/config";
import { createDatabaseConnection, type MigrationState, readMigrationState } from "@injurysub/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refuseRecordedEspnWhenHosted, waitForMigrations } from "./espn-startup";
import { WorkerStartupError } from "./startup-error";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureWorkerLog() {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  return {
    logger: createLogger("worker", "debug"),
    events: (): Record<string, unknown>[] => printed.map((line) => JSON.parse(line)),
  };
}

const hosted = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app@db.internal.example:5432/injurysub",
  APP_BASE_URL: "https://injurysub.example",
  SESSION_SECRET: "s".repeat(48),
  EMAIL_DELIVERY_MODE: "resend",
  RESEND_API_KEY: "re_invented_key",
  EMAIL_FROM_ADDRESS: "signin@mail.injurysub.example",
  WORKER_INTERNAL_TOKEN: "t".repeat(64),
};

describe("refuseRecordedEspnWhenHosted", () => {
  it.each([
    "stub",
    "scripted",
  ])("stops a hosted worker reading %s ESPN data, naming ESPN_MODE", (mode) => {
    const env = loadServerEnv({ ...hosted, ESPN_MODE: mode, ESPN_SCENARIO: "one-out-starter" });

    expect(() => refuseRecordedEspnWhenHosted(env)).toThrow(WorkerStartupError);
    expect(() => refuseRecordedEspnWhenHosted(env)).toThrow(/ESPN_MODE/);
  });

  it("lets a hosted worker run without the cookie, and a local one read recordings", () => {
    expect(() =>
      refuseRecordedEspnWhenHosted(loadServerEnv({ ...hosted, ESPN_MODE: "none" }))
    ).not.toThrow();
    expect(() => refuseRecordedEspnWhenHosted(loadServerEnv({ ESPN_MODE: "stub" }))).not.toThrow();
  });
});

describe("waitForMigrations", () => {
  const current: MigrationState = { hasAccountsTable: true, latestApplied: 5, latestKnown: 5 };
  const behind: MigrationState = { ...current, latestApplied: 4 };
  const noWait = async () => {};

  it("returns at once for a database at this checkout's migrations", async () => {
    const log = captureWorkerLog();

    await waitForMigrations({
      readState: async () => current,
      logger: log.logger,
      sleep: noWait,
      attempts: 3,
    });

    expect(log.events()).toEqual([]);
  });

  it("waits for a database behind the migrations until web's pre-deploy brings it up", async () => {
    const log = captureWorkerLog();
    const states = [behind, behind, current];

    await waitForMigrations({
      readState: async () => states.shift()!,
      logger: log.logger,
      sleep: noWait,
      attempts: 3,
    });

    expect(log.events().map((line) => line.event)).toEqual([
      "worker.migrations.waiting",
      "worker.migrations.waiting",
    ]);
  });

  it("gives up on a database still behind after its attempts, and on one it can't reach", async () => {
    const log = captureWorkerLog();

    await expect(
      waitForMigrations({
        readState: async () => behind,
        logger: log.logger,
        sleep: noWait,
        attempts: 2,
      })
    ).rejects.toThrow(WorkerStartupError);
    // 127.0.0.2 refuses at once; nothing listens there.
    const dead = createDatabaseConnection({
      connectionString: "postgres://postgres@127.0.0.2:1/injurysub",
    });
    try {
      await expect(
        waitForMigrations({
          readState: () => readMigrationState(dead.db),
          logger: log.logger,
          sleep: noWait,
          attempts: 2,
        })
      ).rejects.toThrow(WorkerStartupError);
    } finally {
      await dead.close();
    }
    expect(
      log.events().filter((line) => line.event === "worker.migrations.waiting")
    ).toContainEqual(expect.objectContaining({ reason: "ECONNREFUSED" }));
  });

  it("starts against a database a newer version migrated, and says so", async () => {
    const log = captureWorkerLog();

    await waitForMigrations({
      readState: async () => ({ ...current, latestApplied: 6 }),
      logger: log.logger,
      sleep: noWait,
      attempts: 1,
    });

    expect(log.events()).toEqual([expect.objectContaining({ event: "worker.migrations.ahead" })]);
  });
});
