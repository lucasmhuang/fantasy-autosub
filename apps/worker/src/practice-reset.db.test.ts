import { randomUUID } from "node:crypto";
import { createLogger, loadServerEnv } from "@injurysub/config";
import {
  acquireWriteLease,
  countPracticeReset,
  type DatabaseConnection,
  emailOutbox,
  markEmptyDatabasePractice,
  misuseAlerts,
  readPracticeSince,
  releaseWriteLease,
} from "@injurysub/db";
import type { EspnClient } from "@injurysub/espn";
import type { TestDatabase } from "@injurysub/test-db";
import { afterEach, describe, expect, vi } from "vitest";
import { createWorkerEspn } from "./espn-client";
import { runExecutorPass } from "./executor/executor";
import {
  contextFor,
  insertQueued,
  insertTatumRequest,
  LARSSON,
  rehearsingContextFor,
  setUp,
  TATUM,
  TEAM,
} from "./executor/test-support";
import { createPracticeCopy } from "./practice-copy";
import { type PracticeResetOptions, runPracticeReset } from "./practice-reset";
import { dbTest } from "./test-support";

type Database = TestDatabase<DatabaseConnection>;
type LogLine = Record<string, unknown>;

const now = new Date("2026-11-16T03:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

async function practiceEspn() {
  const espn = await createWorkerEspn(loadServerEnv({ ESPN_MODE: "practice" }));
  const { practice } = espn;
  if (practice === null) throw new Error("practice mode built no fake ESPN");
  return { ...espn, practice };
}

// A practice database as staging's would be after a walk: one completed request with its two
// writes, an email about it in the outbox, and a misuse alert matched to it.
async function walkedPracticeDatabase(database: Database) {
  const espn = await practiceEspn();
  const { db } = database.connection;
  // After the settings are saved: a save expecting none is refused once the mark made the row.
  const setup = await setUp(database.connection, [TEAM], espn.practice);
  await markEmptyDatabasePractice(db, now);
  const requestId = await insertTatumRequest(setup);
  await runExecutorPass({ ...contextFor(setup), espn: espn.read, write: espn.write });
  await db.insert(emailOutbox).values({
    emailId: randomUUID(),
    dedupeKey: `invented:${requestId}`,
    toAddress: "commissioner@example.test",
    subject: "Invented",
    body: "Invented",
    requestId,
  });
  await db.insert(misuseAlerts).values({
    alertId: randomUUID(),
    espnRef: `invented-${requestId}`,
    kind: "lm_transaction",
    details: {},
    foundAt: now,
    matchedRequestId: requestId,
  });
  return { espn, setup };
}

// Runs the reset with the real logger, capturing the lines it prints.
async function reset(
  database: Database,
  options: { apply: boolean } & Partial<PracticeResetOptions>
) {
  const printed: string[] = [];
  const capture = (line: unknown) => {
    printed.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  const logger = createLogger("practice", "debug");
  const { exitCode } = await runPracticeReset({
    databaseUrl: database.url,
    logger,
    now,
    ...options,
  });
  vi.restoreAllMocks();
  const lines: LogLine[] = printed.map((line) => JSON.parse(line));
  return {
    exitCode,
    summary: lines.find((line) => line.event === "practice.reset.summary"),
    failure: lines.find((line) => line.event === "practice.reset.failed"),
  };
}

async function seenOn(read: EspnClient) {
  const { team } = await read.getLineup(TEAM);
  const slots = [...team.starters, ...team.bench, ...team.injuredReserve];
  const slotOf = (id: number) => slots.find((slot) => slot.player?.playerId === id)?.slot;
  return { tatum: slotOf(TATUM), larsson: slotOf(LARSSON) };
}

function quietWorkerLog() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("runPracticeReset", () => {
  dbTest("names what a dry run would remove, and changes nothing", async ({ database }) => {
    quietWorkerLog();
    await walkedPracticeDatabase(database);
    const before = await countPracticeReset(database.connection.db);

    const { exitCode, summary, failure } = await reset(database, { apply: false });

    expect({ exitCode, failure }).toEqual({ exitCode: 0, failure: undefined });
    const { hostname, port, pathname } = new URL(database.url);
    expect(summary).toMatchObject({
      target: `${hostname}:${port}${pathname}`,
      mode: "dry run",
      standing: "practice",
      marked: false,
      ...before,
    });
    expect(before).toMatchObject({ requests: 1, writes: 2, alerts: 1 });
    expect(await countPracticeReset(database.connection.db)).toEqual(before);
  });

  dbTest(
    "empties a practice database's requests, and the next pass rebuilds its copy to the seed",
    async ({ database }) => {
      quietWorkerLog();
      const { espn } = await walkedPracticeDatabase(database);
      const { db } = database.connection;
      const copy = createPracticeCopy(espn.practice);
      await copy.sync(db);
      const before = await countPracticeReset(db);

      const { exitCode, summary } = await reset(database, { apply: true });

      expect(exitCode).toBe(0);
      expect(summary).toMatchObject({ mode: "applied", standing: "practice", ...before });
      expect(await countPracticeReset(db)).toEqual({
        requests: 0,
        writes: 0,
        emails: 0,
        alerts: 0,
      });
      expect(await db.$count(misuseAlerts)).toBe(1);
      expect(await copy.sync(db)).toEqual({ rebuilt: true, writes: 0 });
      expect(await seenOn(espn.read)).toEqual({ tatum: "F", larsson: "BE" });
      expect(await acquireWriteLease(db, { holder: "next-pass", ttlSeconds: 60 })).not.toBe(null);
    }
  );

  dbTest(
    "refuses a database with a write ESPN answered and no practice mark, dry run or not",
    async ({ database }) => {
      quietWorkerLog();
      const espn = await practiceEspn();
      const setup = await setUp(database.connection, [TEAM], espn.practice);
      await insertTatumRequest(setup);
      await runExecutorPass({ ...contextFor(setup), espn: espn.read, write: espn.write });
      const before = await countPracticeReset(database.connection.db);

      for (const apply of [false, true]) {
        const { exitCode, summary, failure } = await reset(database, { apply });
        expect({ exitCode, summary }).toEqual({ exitCode: 1, summary: undefined });
        expect(failure).toMatchObject({ code: "not_practice" });
      }
      expect(await countPracticeReset(database.connection.db)).toEqual(before);
      expect(await readPracticeSince(database.connection.db)).toBe(null);
    }
  );

  dbTest(
    "marks a database whose writes were only ever recorded, as a rehearsal leaves them, and empties it",
    async ({ database }) => {
      quietWorkerLog();
      const setup = await setUp(database.connection);
      await insertTatumRequest(setup);
      await runExecutorPass(rehearsingContextFor(setup));

      const { exitCode, summary } = await reset(database, { apply: true });

      expect(exitCode).toBe(0);
      expect(summary).toMatchObject({ standing: "markable", marked: true, requests: 1 });
      expect(await readPracticeSince(database.connection.db)).toEqual(now);
      expect((await countPracticeReset(database.connection.db)).requests).toBe(0);
    }
  );

  dbTest("waits for the ESPN-write lease while a pass holds it", async ({ database }) => {
    quietWorkerLog();
    const { db } = database.connection;
    // Marked before the request, so this is a practice database, not one the reset would mark.
    const setup = await setUp(database.connection);
    await markEmptyDatabasePractice(db, now);
    await insertQueued(setup);
    expect(await readPracticeSince(db)).toEqual(now);
    const held = await acquireWriteLease(db, { holder: "worker-in-a-pass", ttlSeconds: 60 });
    if (held === null) throw new Error("expected the lease");
    // A plain count: the reset helper's restoreAllMocks would clear a mock's calls.
    let sleeps = 0;
    const sleep = async () => {
      sleeps += 1;
      await releaseWriteLease(db, held);
    };

    const { exitCode } = await reset(database, { apply: true, sleep });

    expect(exitCode).toBe(0);
    expect(sleeps).toBe(1);
    expect((await countPracticeReset(db)).requests).toBe(0);
  });

  dbTest("gives up, changing nothing, while the lease stays held", async ({ database }) => {
    quietWorkerLog();
    const { db } = database.connection;
    // Marked before the request, so this is a practice database, not one the reset would mark.
    const setup = await setUp(database.connection);
    await markEmptyDatabasePractice(db, now);
    await insertQueued(setup);
    expect(await readPracticeSince(db)).toEqual(now);
    await acquireWriteLease(db, { holder: "worker-in-a-pass", ttlSeconds: 60 });

    const { exitCode, failure } = await reset(database, { apply: true, leaseWaitMs: 0 });

    expect(exitCode).toBe(1);
    expect(failure).toMatchObject({ code: "lease_busy" });
    expect((await countPracticeReset(db)).requests).toBe(1);
  });
});
