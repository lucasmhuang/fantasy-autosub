import { createLogger, loadServerEnv } from "@injurysub/config";
import { leagueSettings, markEmptyDatabasePractice, readPracticeSince } from "@injurysub/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPracticeDatabase, createLivePassGuard } from "./espn-startup";
import { runExecutorPass } from "./executor/executor";
import {
  contextFor,
  detailOf,
  insertQueued,
  insertTatumRequest,
  setUp,
} from "./executor/test-support";
import { WorkerStartupError } from "./startup-error";
import { dbTest } from "./test-support";

const now = new Date("2026-11-16T02:00:00.000Z");
const earlier = new Date("2026-11-15T02:00:00.000Z");
const practice = loadServerEnv({ ESPN_MODE: "practice" });
// Synthetic values: the real league id and cookies never appear in tests.
const liveEspn = {
  ESPN_MODE: "live",
  ESPN_S2: "AEBsyntheticCookieValue",
  ESPN_SWID: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
  LEAGUE_ID: "4567123",
};
const sendingLive = loadServerEnv({ ...liveEspn, ESPN_SEND_MODE: "live" });

async function failureOf(check: Promise<void>): Promise<unknown> {
  try {
    await check;
  } catch (error) {
    return error;
  }
  throw new Error("expected the check to refuse the database");
}

describe("checkPracticeDatabase", () => {
  dbTest(
    "lets a practice worker start on a database that never held a request, marking it practice",
    async ({ database }) => {
      const { db } = database.connection;

      await checkPracticeDatabase({ db, env: practice, now });

      expect(await readPracticeSince(db)).toEqual(now);
    }
  );

  dbTest(
    "lets a practice worker start on a practice database that holds requests",
    async ({ database }) => {
      const { db } = database.connection;
      await markEmptyDatabasePractice(db, earlier);
      await insertQueued(await setUp(database.connection));

      await checkPracticeDatabase({ db, env: practice, now });

      expect(await readPracticeSince(db)).toEqual(earlier);
    }
  );

  dbTest(
    "stops a practice worker on a database with requests and no practice mark, naming pnpm practice:reset",
    async ({ database }) => {
      const { db } = database.connection;
      await insertQueued(await setUp(database.connection));

      const failure = await failureOf(checkPracticeDatabase({ db, env: practice, now }));

      expect(failure).toBeInstanceOf(WorkerStartupError);
      expect(String(failure)).toMatch(/pnpm practice:reset/);
      expect(await readPracticeSince(db)).toBe(null);
    }
  );

  dbTest(
    "stops a worker that sends to the real league on a practice database",
    async ({ database }) => {
      const { db } = database.connection;
      await markEmptyDatabasePractice(db, earlier);

      expect(await failureOf(checkPracticeDatabase({ db, env: sendingLive, now }))).toBeInstanceOf(
        WorkerStartupError
      );
    }
  );

  dbTest(
    "lets a worker that sends to the real league start on a real database, marking nothing",
    async ({ database }) => {
      const { db } = database.connection;
      await insertQueued(await setUp(database.connection));

      await checkPracticeDatabase({ db, env: sendingLive, now });

      expect(await readPracticeSince(db)).toBe(null);
    }
  );

  dbTest.for([
    { ESPN_MODE: "stub" },
    { ESPN_MODE: "scripted", ESPN_SCENARIO: "one-out-starter" },
    { ESPN_MODE: "none" },
    liveEspn,
  ])(
    "neither marks an empty database nor refuses a practice one for a worker that sends nothing ($ESPN_MODE)",
    async (espn, { database }) => {
      const { db } = database.connection;
      const env = loadServerEnv(espn);

      await checkPracticeDatabase({ db, env, now });
      expect(await readPracticeSince(db)).toBe(null);

      await markEmptyDatabasePractice(db, earlier);
      await checkPracticeDatabase({ db, env, now });
      expect(await readPracticeSince(db)).toEqual(earlier);
    }
  );
});

// The mark can be set after a worker started (a reset run over a tunnel, a restore), so a worker
// sending to the real league checks it in every pass, under the ESPN-write lease, and sends nothing
// while it's set.
describe("createLivePassGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["a practice worker", practice],
    ["a worker that only records", loadServerEnv({ ...liveEspn, ESPN_SEND_MODE: "never" })],
    ["a stub worker", loadServerEnv({ ESPN_MODE: "stub" })],
  ])("has no guard for %s, which sends nothing to the real league", (_, env) => {
    expect(createLivePassGuard(env, createLogger("worker"))).toBeNull();
  });

  dbTest("lets a pass run on a real database", async ({ database }) => {
    const guard = createLivePassGuard(sendingLive, createLogger("worker"));

    expect(await guard?.(database.connection.db)).toBe(true);
  });

  dbTest(
    "sends nothing once the database is marked practice after the worker started, saying so once",
    async ({ database }) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      const { db } = database.connection;
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      await checkPracticeDatabase({ db, env: sendingLive, now });
      await db.update(leagueSettings).set({ practiceSince: now });
      const guard = createLivePassGuard(sendingLive, createLogger("worker"));
      if (guard === null) throw new Error("a live-sending worker has a guard");
      const pass = () =>
        runExecutorPass(
          { ...contextFor(setup), write: setup.fake.write },
          {
            beforeWork: () => guard(db),
          }
        );

      const results = [await pass(), await pass()];

      expect(results).toEqual([{ kind: "skipped" }, { kind: "skipped" }]);
      expect(setup.fake.posts).toEqual([]);
      expect((await detailOf(setup, requestId)).request.status).toBe("queued");
      const refusals = errors.mock.calls.filter(([line]) =>
        String(line).includes('"worker.practice.live_worker_refused"')
      );
      expect(refusals).toHaveLength(1);
    }
  );
});
