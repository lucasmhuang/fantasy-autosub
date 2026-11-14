import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import {
  acknowledgeMisuseAlert,
  getLatestWorkerHeartbeat,
  getMisuseWatch,
  listAcknowledgedMisuseAlerts,
  listOpenMisuseAlerts,
  type NewMisuseAlert,
  recordMisuseAlert,
  recordMisuseWatch,
  recordWorkerHeartbeat,
} from "./monitoring";
import { userAccounts, workerHeartbeats } from "./schema";
import { dbTest } from "./test-support";

const first = new Date("2026-11-15T18:00:00.000Z");
const later = new Date("2026-11-15T18:05:00.000Z");
const latest = new Date("2026-11-15T18:10:00.000Z");

function alert(overrides: Partial<NewMisuseAlert> = {}): NewMisuseAlert {
  return {
    alertId: randomUUID(),
    espnRef: `transaction:${randomUUID()}`,
    kind: "lm_transaction",
    teamId: 4,
    teamName: "Invented Team",
    espnAt: first,
    details: { items: [{ playerId: 11, fromSlot: "BE", toSlot: "G" }] },
    foundAt: later,
    ...overrides,
  };
}

async function insertCommissioner(db: DatabaseExecutor): Promise<string> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `commissioner-${userId}@example.test`,
    displayName: "Invented Commissioner",
    role: "commissioner",
  });
  return userId;
}

describe("misuse alerts", () => {
  dbTest(
    "records one alert per ESPN reference, whatever a later check finds",
    async ({ database }) => {
      const { db } = database.connection;
      const seen = alert();

      const once = await recordMisuseAlert(db, seen);
      const again = await recordMisuseAlert(db, {
        ...seen,
        alertId: randomUUID(),
        details: { changed: true },
        foundAt: latest,
      });

      expect(once.created).toBe(true);
      expect(again.created).toBe(false);
      expect(again.alert).toEqual(once.alert);
      expect(await listOpenMisuseAlerts(db)).toEqual([once.alert]);
    }
  );

  dbTest(
    "lists open alerts by ESPN's time, and an acknowledged one apart, with who and when",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertCommissioner(db);
      const newer = (await recordMisuseAlert(db, alert({ espnAt: later }))).alert;
      const older = (await recordMisuseAlert(db, alert({ espnAt: first }))).alert;

      const acknowledged = await acknowledgeMisuseAlert(db, {
        alertId: older.alertId,
        userId,
        at: latest,
      });

      expect(acknowledged).toMatchObject({ acknowledgedAt: latest, acknowledgedBy: userId });
      expect(await listOpenMisuseAlerts(db)).toEqual([newer]);
      expect(await listAcknowledgedMisuseAlerts(db, 10)).toEqual([acknowledged]);
    }
  );

  dbTest("keeps the first acknowledgement of an alert", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertCommissioner(db);
    const { alertId } = (await recordMisuseAlert(db, alert())).alert;
    await acknowledgeMisuseAlert(db, { alertId, userId, at: later });

    const second = await acknowledgeMisuseAlert(db, { alertId, userId, at: latest });

    expect(second).toBe(null);
    expect(await listAcknowledgedMisuseAlerts(db, 10)).toMatchObject([{ acknowledgedAt: later }]);
  });

  dbTest("records an alert acknowledged as it is found", async ({ database }) => {
    const { db } = database.connection;

    const { alert: found } = await recordMisuseAlert(
      db,
      alert({ acknowledgedAt: later, acknowledgedNote: "The owner's edit (Dec-D15)" })
    );

    expect(await listOpenMisuseAlerts(db)).toEqual([]);
    expect(await listAcknowledgedMisuseAlerts(db, 10)).toEqual([found]);
  });
});

describe("the misuse watch", () => {
  dbTest(
    "keeps a pause's start while it lasts, and the last day read through only from checks that read",
    async ({ database }) => {
      const { db } = database.connection;

      const working = await recordMisuseWatch(db, {
        state: "working",
        code: null,
        checkedAt: first,
        scannedThroughDay: 26,
        firstRunAt: first,
      });
      const paused = await recordMisuseWatch(db, {
        state: "unreachable",
        code: "espn_unavailable",
        checkedAt: later,
      });
      const stillPaused = await recordMisuseWatch(db, {
        state: "unreachable",
        code: "espn_unavailable",
        checkedAt: latest,
      });

      expect([working.startedNow, paused.startedNow, stillPaused.startedNow]).toEqual([
        true,
        true,
        false,
      ]);
      expect(await getMisuseWatch(db)).toEqual({
        watchId: 1,
        state: "unreachable",
        code: "espn_unavailable",
        since: later,
        checkedAt: latest,
        firstRunAt: first,
        scannedThroughDay: 26,
      });
    }
  );

  dbTest("has no record before detection's first check", async ({ database }) => {
    expect(await getMisuseWatch(database.connection.db)).toBe(null);
  });
});

describe("worker heartbeats", () => {
  dbTest("keeps one row per worker, and gives the newest beat of any", async ({ database }) => {
    const { db } = database.connection;
    expect(await getLatestWorkerHeartbeat(db)).toBe(null);

    await recordWorkerHeartbeat(db, { workerId: "worker-a", startedAt: first, beatAt: first });
    await recordWorkerHeartbeat(db, { workerId: "worker-b", startedAt: first, beatAt: later });
    await recordWorkerHeartbeat(db, { workerId: "worker-a", startedAt: first, beatAt: latest });

    expect(await getLatestWorkerHeartbeat(db)).toEqual({
      workerId: "worker-a",
      startedAt: first,
      beatAt: latest,
    });
    expect(await db.select().from(workerHeartbeats)).toHaveLength(2);
  });
});
