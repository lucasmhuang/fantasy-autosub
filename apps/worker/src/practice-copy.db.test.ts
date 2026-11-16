import { randomUUID } from "node:crypto";
import { createLogger, loadServerEnv } from "@injurysub/config";
import {
  acquireWriteLease,
  type DatabaseConnection,
  espnWrites,
  type WriteLease,
} from "@injurysub/db";
import type { EspnClient } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { createWorkerEspn } from "./espn-client";
import { runExecutorPass } from "./executor/executor";
import {
  attemptsOf,
  claimedAndStopped,
  contextFor,
  detailOf,
  insertTatumRequest,
  LARSSON,
  sendThenStop,
  setUp,
  TATUM,
  TATUM_OWED,
  TEAM,
} from "./executor/test-support";
import {
  createPassSync,
  createPracticeCopy,
  PracticeCopyUnreplayableError,
  syncPracticeCopyAtStart,
} from "./practice-copy";
import { WorkerStartupError } from "./startup-error";
import { dbTest } from "./test-support";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// A practice worker's ESPN, as one starts: a new process has a new copy.
async function practiceEspn() {
  const espn = await createWorkerEspn(loadServerEnv({ ESPN_MODE: "practice" }));
  const { practice } = espn;
  if (practice === null) throw new Error("practice mode built no fake ESPN");
  return { ...espn, practice };
}

// What team 1's board shows of a Tatum-for-Larsson request: both players' slots and the side's
// adjustment, none in the recordings.
async function seenOn(read: EspnClient) {
  const { team } = await read.getLineup(TEAM);
  const slots = [...team.starters, ...team.bench, ...team.injuredReserve];
  const slotOf = (id: number) => slots.find((slot) => slot.player?.playerId === id)?.slot;
  const { week } = await read.getCurrentWeek();
  const sides = week.matchups.flatMap((matchup) => [matchup.home, matchup.away]);
  const side = sides.find((candidate) => candidate?.teamId === TEAM);
  return { tatum: slotOf(TATUM), larsson: slotOf(LARSSON), adjustment: side?.adjustment };
}
const SEED = { tatum: "F", larsson: "BE", adjustment: 0 };
const DONE = { tatum: "BE", larsson: "F", adjustment: TATUM_OWED / 10 };

describe("createPracticeCopy", () => {
  dbTest(
    "builds a restarted worker's copy from the seed and the verified writes, so its board agrees with the request",
    async ({ database }) => {
      const before = await practiceEspn();
      const setup = await setUp(database.connection, [TEAM], before.practice);
      const requestId = await insertTatumRequest(setup);
      await runExecutorPass({ ...contextFor(setup), espn: before.read, write: before.write });
      const done = await seenOn(before.read);

      const restarted = await practiceEspn();
      const copy = createPracticeCopy(restarted.practice);

      expect(await copy.sync(database.connection.db)).toEqual({ rebuilt: true, writes: 2 });
      expect(await seenOn(restarted.read)).toEqual(done);
      expect(done).toEqual(DONE);
      expect((await detailOf(setup, requestId)).request.status).toBe("completed");
    }
  );

  dbTest(
    "rebuilds only once the database's verified writes differ from the ones it was built from",
    async ({ database }) => {
      const espn = await practiceEspn();
      const setup = await setUp(database.connection, [TEAM], espn.practice);
      const copy = createPracticeCopy(espn.practice);
      const { db } = database.connection;

      expect(await copy.sync(db)).toEqual({ rebuilt: true, writes: 0 });
      expect(await copy.sync(db)).toEqual({ rebuilt: false, writes: 0 });

      await insertTatumRequest(setup);
      await runExecutorPass({ ...contextFor(setup), espn: espn.read, write: espn.write });
      expect(await copy.sync(db)).toEqual({ rebuilt: true, writes: 2 });
      expect(await copy.sync(db)).toEqual({ rebuilt: false, writes: 2 });
      expect(await seenOn(espn.read)).toEqual(DONE);
    }
  );

  dbTest("rebuilds to the seed once the verified writes are gone", async ({ database }) => {
    const espn = await practiceEspn();
    const setup = await setUp(database.connection, [TEAM], espn.practice);
    const copy = createPracticeCopy(espn.practice);
    const { db } = database.connection;
    await insertTatumRequest(setup);
    await runExecutorPass({ ...contextFor(setup), espn: espn.read, write: espn.write });
    await copy.sync(db);

    await db.delete(espnWrites);

    expect(await copy.sync(db)).toEqual({ rebuilt: true, writes: 0 });
    expect(await seenOn(espn.read)).toEqual(SEED);
  });

  dbTest(
    "leaves out a write sent but not read back when the worker stopped, for recovery's readback to decide",
    async ({ database }) => {
      const before = await practiceEspn();
      const setup = await setUp(database.connection, [TEAM], before.practice);
      const requestId = await insertTatumRequest(setup);
      const { edit } = await claimedAndStopped(setup, requestId);
      await sendThenStop(setup, { requestId, kind: "lineup" }, (write, guard) =>
        write.applyLineup({ teamId: TEAM, scoringPeriodId: 8, moves: edit.items }, guard)
      );

      const restarted = await practiceEspn();
      const copy = createPracticeCopy(restarted.practice);
      expect(await copy.sync(database.connection.db)).toEqual({ rebuilt: true, writes: 0 });
      expect(await seenOn(restarted.read)).toEqual(SEED);
      // Tatum's OUT came from the test, not a scenario seed, so the new copy needs it too.
      restarted.practice.setDesignation(TATUM, "OUT");

      const pass = () =>
        runExecutorPass({
          ...contextFor({ ...setup, fake: restarted.practice }),
          espn: restarted.read,
          write: restarted.write,
        });

      // Nothing of the write is on this copy, so the request goes back in line, then runs anew.
      expect(await pass()).toEqual({ kind: "requeued" });
      expect((await attemptsOf(setup, requestId)).map(({ outcome }) => outcome)).toEqual([
        "not_applied",
      ]);
      expect(await pass()).toMatchObject({ kind: "completed" });
      expect(await seenOn(restarted.read)).toEqual(DONE);
    }
  );
});

// A verified lineup write, on the request, for a day the seed doesn't hold (day 99).
async function insertUnreplayableWrite(
  db: DatabaseConnection["db"],
  requestId: string,
  sentAt: Date
) {
  await db.insert(espnWrites).values({
    writeId: randomUUID(),
    requestId,
    kind: "lineup",
    teamId: TEAM,
    matchupId: 12,
    scoringPeriodId: 99,
    body: {
      teamId: TEAM,
      scoringPeriodId: 99,
      items: [{ playerId: TATUM, fromLineupSlotId: 4, toLineupSlotId: 12 }],
    },
    fencingToken: 1,
    status: "answered",
    outcome: "verified",
    sentAt,
  });
}

// A request whose only verified write is one the seed can't take.
async function unreplayable(connection: DatabaseConnection) {
  const espn = await practiceEspn();
  const setup = await setUp(connection, [TEAM], espn.practice);
  const requestId = await insertTatumRequest(setup);
  const { db } = connection;
  await insertUnreplayableWrite(db, requestId, new Date());
  const restarted = await practiceEspn();
  return { db, setup, requestId, restarted, copy: createPracticeCopy(restarted.practice) };
}

// A verified write the seed can't take (the recordings recaptured on another day, say): the copy
// can't be rebuilt, and only `pnpm practice:reset` makes the database fit the seed again.
describe("a verified write the practice copy can't replay", () => {
  dbTest("fails the sync with its own error, leaving the copy as it was", async ({ database }) => {
    const { db, restarted, copy } = await unreplayable(database.connection);

    const failure = await copy.sync(db).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PracticeCopyUnreplayableError);
    expect(await seenOn(restarted.read)).toEqual(SEED);
  });

  // The board reads the copy whether or not a pass runs, so a failed rebuild must leave it whole.
  dbTest(
    "keeps the copy it had, swap and adjustment, when a rebuild fails",
    async ({ database }) => {
      const espn = await practiceEspn();
      const setup = await setUp(database.connection, [TEAM], espn.practice);
      const copy = createPracticeCopy(espn.practice);
      const { db } = database.connection;
      const requestId = await insertTatumRequest(setup);
      await runExecutorPass({ ...contextFor(setup), espn: espn.read, write: espn.write });
      await copy.sync(db);
      // Sent before the request's two writes, so a rebuild meets it first.
      await insertUnreplayableWrite(db, requestId, new Date("2026-01-01T00:00:00.000Z"));

      const failure = await copy.sync(db).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(PracticeCopyUnreplayableError);
      expect(await seenOn(espn.read)).toEqual(DONE);
    }
  );

  dbTest("stops the worker at startup, naming pnpm practice:reset", async ({ database }) => {
    const { db, copy } = await unreplayable(database.connection);
    const logger = createLogger("worker", "debug");

    const failure = await syncPracticeCopyAtStart(copy, db, logger).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(WorkerStartupError);
    expect(String((failure as Error).message)).toContain("pnpm practice:reset");
  });

  dbTest("skips each pass meanwhile, saying why once", async ({ database }) => {
    const { db, copy } = await unreplayable(database.connection);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const beforePass = createPassSync(copy, createLogger("worker", "debug"));

    const passes = [await beforePass(db), await beforePass(db)];

    expect(passes).toEqual([false, false]);
    const unreplayableLines = errors.mock.calls.filter(([line]) =>
      String(line).includes('"worker.practice.copy_unreplayable"')
    );
    expect(unreplayableLines).toHaveLength(1);
  });

  dbTest("lets a pass run once the copy can be rebuilt again", async ({ database }) => {
    const { db, copy } = await unreplayable(database.connection);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const beforePass = createPassSync(copy, createLogger("worker", "debug"));
    await beforePass(db);

    await db.delete(espnWrites);

    expect(await beforePass(db)).toBe(true);
  });
});

// The copy is brought up to date inside the pass, under the ESPN-write lease: a write another
// worker verifies meanwhile (two overlap during a deploy) can't land between the sync and the pass.
describe("a practice worker's executor pass", () => {
  dbTest(
    "brings the copy up to date only while it holds the ESPN-write lease",
    async ({ database }) => {
      const espn = await practiceEspn();
      const setup = await setUp(database.connection, [TEAM], espn.practice);
      const { db } = database.connection;
      const takenMeanwhile: (WriteLease | null)[] = [];

      await runExecutorPass(
        { ...contextFor(setup), espn: espn.read, write: espn.write },
        {
          beforeWork: async () => {
            takenMeanwhile.push(
              await acquireWriteLease(db, { holder: "another-worker", ttlSeconds: 60 })
            );
            return true;
          },
        }
      );

      expect(takenMeanwhile).toEqual([null]);
    }
  );

  dbTest(
    "leaves the queue as it was while the copy can't follow the database",
    async ({ database }) => {
      const { db, setup, requestId, restarted, copy } = await unreplayable(database.connection);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const beforePass = createPassSync(copy, createLogger("worker", "debug"));

      const result = await runExecutorPass(
        {
          ...contextFor({ ...setup, fake: restarted.practice }),
          espn: restarted.read,
          write: restarted.write,
        },
        { beforeWork: () => beforePass(db) }
      );

      expect(result).toEqual({ kind: "skipped" });
      expect((await detailOf(setup, requestId)).request.status).toBe("queued");
    }
  );
});
