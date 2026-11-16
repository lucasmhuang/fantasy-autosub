import { loadServerEnv } from "@injurysub/config";
import { espnWrites } from "@injurysub/db";
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
import { createPracticeCopy } from "./practice-copy";
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
