import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  recordEspnAccess,
  recordLeagueRulesCheck,
  recordMisuseAlert,
  recordMisuseWatch,
  recordTeamNames,
  recordWorkerHeartbeat,
  switchAutomationOff,
  writeLeagueSettings,
} from "@injurysub/db";
import type { RequestEventType } from "@injurysub/domain";
import { cutConnectionAt } from "@injurysub/test-db";
import { describe, expect } from "vitest";
import { createWebDatabaseConnection } from "./db";
import { loadQueue } from "./queue";
import { insertInventedRequest, insertInventedUser, webDbTest } from "./test-support";

const now = new Date("2026-11-17T05:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const steals = { kind: "setting", setting: "Steals points", expected: "3", espn: "2" } as const;

async function insertAlert(db: DatabaseExecutor, espnAt: Date, teamId = 4) {
  await recordMisuseAlert(db, {
    alertId: randomUUID(),
    espnRef: `transaction:${randomUUID()}`,
    kind: "lm_transaction",
    teamId,
    teamName: null,
    espnAt,
    details: { what: "invented", undo: [] },
    foundAt: espnAt,
  });
}

async function event(
  db: DatabaseExecutor,
  requestId: string,
  type: RequestEventType,
  payload: object
) {
  await appendEvent(db, requestId, {
    eventId: randomUUID(),
    actorType: "system",
    eventType: type,
    payload,
    createdAt: minutesAgo(5),
  });
}

describe("loadQueue", () => {
  webDbTest(
    "puts requests and alerts that need the commissioner first, oldest first, then the rest newest first",
    async ({ database }) => {
      const { db } = database.connection;
      const review = await insertInventedRequest(db, { teamId: 1, createdAt: minutesAgo(50) });
      await insertAlert(db, minutesAgo(40));
      const approval = await insertInventedRequest(db, {
        teamId: 2,
        status: "awaiting_approval",
        reviewReason: null,
        createdAt: minutesAgo(30),
        expiresAt: minutesAgo(-600),
      });
      const older = await insertInventedRequest(db, {
        teamId: 3,
        status: "completed",
        reviewReason: null,
        createdAt: minutesAgo(20),
      });
      const newer = await insertInventedRequest(db, {
        teamId: 4,
        status: "completed_manually",
        reviewReason: null,
        createdAt: minutesAgo(10),
      });

      const queue = await loadQueue({ now });

      expect(queue.status).toBe("found");
      if (queue.status !== "found") return;
      expect(queue.needsYou.map((row) => (row.kind === "alert" ? "alert" : row.requestId))).toEqual(
        [review, "alert", approval]
      );
      expect(queue.needsYou[2]).toMatchObject({ expiresAt: minutesAgo(-600) });
      expect(queue.rest.map((row) => row.requestId)).toEqual([newer, older]);
    }
  );

  webDbTest(
    "names each team as ESPN does, and leaves the name out where none was read",
    async ({ database }) => {
      const { db } = database.connection;
      await recordTeamNames(db, { teams: [{ teamId: 1, name: "Invented Team One" }], now });
      await insertInventedRequest(db, { teamId: 1 });
      await insertInventedRequest(db, { teamId: 5, createdAt: minutesAgo(1) });
      await insertAlert(db, minutesAgo(2), 1);

      const queue = await loadQueue({ now });

      expect(
        queue.status === "found" && queue.needsYou.map(({ teamId, teamName }) => [teamId, teamName])
      ).toEqual([
        [1, "Invented Team One"],
        [1, "Invented Team One"],
        [5, null],
      ]);
    }
  );

  // FS-APP-14 (D8-1): a request's row names its team's active manager.
  webDbTest("gives each request its team's active manager", async ({ database }) => {
    const { db } = database.connection;
    await insertInventedUser(db, { teamId: 1, isActive: false });
    await insertInventedUser(db, { teamId: 1 });
    await insertInventedUser(db, { teamId: 5, isActive: false });
    await insertInventedRequest(db, { teamId: 1 });
    await insertInventedRequest(db, { teamId: 5, createdAt: minutesAgo(1) });

    const queue = await loadQueue({ now });

    expect(
      queue.status === "found" &&
        queue.needsYou.flatMap((row) => (row.kind === "request" ? [row.managerName] : []))
    ).toEqual(["Invented Person", null]);
  });

  webDbTest(
    "reads health from what the worker stored, counting the requests ESPN holds up",
    async ({ database }) => {
      const { db } = database.connection;
      await recordEspnAccess(db, {
        state: "credentials_rejected",
        code: "credentials_rejected",
        checkedAt: minutesAgo(9),
      });
      await recordLeagueRulesCheck(db, { mismatches: [], checkedAt: minutesAgo(30) });
      await recordLeagueRulesCheck(db, { mismatches: [steals], checkedAt: minutesAgo(15) });
      await recordWorkerHeartbeat(db, {
        workerId: "w",
        startedAt: minutesAgo(60),
        beatAt: minutesAgo(1),
      });
      await recordMisuseWatch(db, { state: "working", code: null, checkedAt: minutesAgo(3) });
      await insertInventedRequest(db, { status: "queued", reviewReason: null });
      await insertInventedRequest(db, { status: "executing", reviewReason: null, teamId: 2 });

      const queue = await loadQueue({ now });

      expect(queue.status === "found" && queue.health).toEqual({
        espn: { state: "credentials_rejected", since: minutesAgo(9), checkedAt: minutesAgo(9) },
        blockedCount: 2,
        worker: { lastBeatAt: minutesAgo(1), down: false },
        rules: {
          mismatches: [steals],
          checkedAt: minutesAgo(15),
          lastMatchedAt: minutesAgo(30),
        },
        watch: { state: "watching", checkedAt: minutesAgo(3) },
      });
    }
  );

  webDbTest(
    "calls the swap runner down from its last beat, and has nothing else before any check",
    async ({ database }) => {
      const { db } = database.connection;
      await recordWorkerHeartbeat(db, {
        workerId: "w",
        startedAt: minutesAgo(60),
        beatAt: minutesAgo(4),
      });

      const queue = await loadQueue({ now });

      expect(queue.status === "found" && queue.health).toEqual({
        espn: null,
        blockedCount: 0,
        worker: { lastBeatAt: minutesAgo(4), down: true },
        rules: null,
        watch: { state: "not_started" },
      });
      expect(queue.status === "found" && [queue.needsYou, queue.rest]).toEqual([[], []]);
    }
  );

  webDbTest("gives each reason the facts its sentence names", async ({ database }) => {
    const { db } = database.connection;
    await insertInventedRequest(
      db,
      { teamId: 1, reviewReason: "rearrangement", createdAt: minutesAgo(50) },
      {
        plan: [
          { playerId: 6606, fromSlot: "G", toSlot: "BE" },
          { playerId: 11, fromSlot: "F", toSlot: "UTIL" },
          { playerId: 12, fromSlot: "UTIL", toSlot: "C" },
          { playerId: 5144091, fromSlot: "BE", toSlot: "G" },
        ],
        lineup: {
          starters: [{ player: { playerId: 11, name: "Invented Forward" } }],
          bench: [{ player: { playerId: 12, name: "Invented Center" } }],
          injuredReserve: [],
        },
      }
    );
    const refused = await insertInventedRequest(db, {
      teamId: 2,
      reviewReason: "adjustment_failed",
      createdAt: minutesAgo(40),
    });
    await event(db, refused, "adjustment_sent", { finalTenths: -194, targetTenths: 0 });
    await event(db, refused, "sent_to_review", { reason: "adjustment_failed" });
    const changed = await insertInventedRequest(db, {
      teamId: 3,
      reviewReason: "adjustment_changed",
      approvedComputedTenths: -821,
      createdAt: minutesAgo(30),
    });
    await event(db, changed, "sent_to_review", {
      computedTenths: -878,
      approvedComputedTenths: -821,
      overrideTenths: null,
    });
    const held = await insertInventedRequest(db, {
      teamId: 4,
      reviewReason: "adjustment_held_rules",
      createdAt: minutesAgo(20),
    });
    await event(db, held, "sent_to_review", { computedTenths: -100, mismatches: [steals] });
    const full = await insertInventedRequest(db, {
      teamId: 5,
      reviewReason: "next_week_full",
      createdAt: minutesAgo(10),
    });
    await event(db, full, "sent_to_review", {
      reason: "next_week_full",
      nextWeekDay: 35,
      activeAfter: 15,
      activeLimit: 14,
      offIr: [{ playerId: 11, name: "Invented Forward" }],
    });

    const queue = await loadQueue({ now });
    const facts =
      queue.status === "found" ? queue.needsYou.map((row) => "facts" in row && row.facts) : [];

    expect(facts[0]).toMatchObject({
      otherMoves: [
        { name: "Invented Forward", toSlot: "UTIL" },
        { name: "Invented Center", toSlot: "C" },
      ],
    });
    expect(facts[1]).toMatchObject({ sentTenths: -194, reviewedAt: minutesAgo(5) });
    expect(facts[2]).toMatchObject({ approvedTenths: -821, heldTenths: -878 });
    expect(facts[3]).toMatchObject({ mismatches: [steals] });
    expect(facts[4]).toMatchObject({ offIr: ["Invented Forward"] });
  });

  webDbTest("says when automation was switched off", async ({ database }) => {
    const { db } = database.connection;
    const commissioner = await insertInventedUser(db, { role: "commissioner" });
    await writeLeagueSettings(db, {
      executionMode: "approval_required",
      writeAllowlist: [1, 2],
      updatedBy: commissioner,
      now: minutesAgo(60),
      shownUpdatedAt: null,
    });
    await switchAutomationOff(db, { updatedBy: commissioner, now: minutesAgo(10) });

    const queue = await loadQueue({ now });

    expect(queue.status === "found" && queue.automation).toEqual({
      status: "switched_off",
      mode: "approval_required",
      teamCount: 2,
      changedAt: minutesAgo(10),
    });
  });

  webDbTest(
    "says the queue couldn't load when the database stops answering",
    async ({ database }) => {
      await insertInventedRequest(database.connection.db);
      const proxy = await cutConnectionAt(database.url, 'from "sub_requests"');
      const cut = createWebDatabaseConnection(proxy.url);
      globalThis.__injurysubWebDb = cut;
      try {
        expect(await loadQueue({ now })).toEqual({ status: "unavailable" });
      } finally {
        await cut.close();
        await proxy.close();
        globalThis.__injurysubWebDb = database.connection;
      }
    }
  );
});
