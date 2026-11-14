import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import { violatedUniqueIndex } from "./failure";
import {
  type CreateRequestInput,
  createRequest,
  findActiveRequest,
  findEarlierCreditingRequest,
  getRequestDetail,
  listActiveTeamRequests,
  listCommissionerQueue,
  listProvingRequests,
  listTeamRequests,
  listWaitingRequests,
  type NewSubRequest,
  transitionRequest,
} from "./requests";
import {
  emailOutbox,
  subRequestEvents,
  subRequestSnapshots,
  subRequests,
  userAccounts,
} from "./schema";
import { dbTest } from "./test-support";

const now = new Date("2026-11-05T20:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

// Invented people only.
async function insertInventedUser(db: DatabaseExecutor, teamId: number): Promise<string> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `person-${userId}@example.test`,
    teamId,
    displayName: "Invented Person",
    role: "manager",
  });
  return userId;
}

function newRequest(requestedBy: string, overrides: Partial<NewSubRequest> = {}): NewSubRequest {
  return {
    requestId: randomUUID(),
    kind: "substitution",
    teamId: 5,
    season: 2027,
    matchupPeriodId: 3,
    matchupId: 31,
    requestedBy,
    idempotencyKey: randomUUID(),
    injuredPlayerId: 2,
    injuredName: "Invented Starter",
    injuredSlot: "G",
    replacementPlayerId: 20,
    replacementName: "Invented Bench",
    requestMoment: now,
    filedAt: now,
    requestDay: 15,
    designationAtRequest: "OUT",
    replacementPointsAtRequestTenths: 0,
    snapshotSource: "observed",
    status: "needs_review",
    reviewReason: "automation_off",
    executionModeAtRequest: "approval_required",
    projectedAdjustmentTenths: 51,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function creation(request: NewSubRequest, withEmail = true): CreateRequestInput {
  return {
    request,
    snapshot: { snapshotId: randomUUID(), espnDay: 15, takenAt: now, payload: { lineup: [] } },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: request.requestedBy,
      eventType: "request_filed",
      payload: {},
      createdAt: now,
    },
    email: withEmail
      ? {
          emailId: randomUUID(),
          dedupeKey: `${request.requestId}:0`,
          toAddress: "commissioner@example.test",
          subject: "Team 5 needs you",
          body: "Body",
          createdAt: now,
        }
      : null,
  };
}

describe("createRequest", () => {
  dbTest(
    "records the request with its request snapshot, its event and the commissioner's email",
    async ({ database }) => {
      const { db } = database.connection;
      const request = newRequest(await insertInventedUser(db, 5));

      const result = await createRequest(db, creation(request));

      expect(result).toMatchObject({ created: true, request: { requestId: request.requestId } });
      expect(
        await db.select({ phase: subRequestSnapshots.phase }).from(subRequestSnapshots)
      ).toEqual([{ phase: "request" }]);
      expect(
        await db.select({ eventType: subRequestEvents.eventType }).from(subRequestEvents)
      ).toEqual([{ eventType: "request_filed" }]);
      expect(await db.select({ dedupeKey: emailOutbox.dedupeKey }).from(emailOutbox)).toEqual([
        { dedupeKey: `${request.requestId}:0` },
      ]);
    }
  );

  dbTest(
    "gives all five of five simultaneous submissions of one Confirm the same single request",
    async ({ database }) => {
      const { connection } = database;
      const requestedBy = await insertInventedUser(connection.db, 5);
      const idempotencyKey = randomUUID();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          connection.transaction((tx) =>
            createRequest(tx, creation(newRequest(requestedBy, { idempotencyKey })))
          )
        )
      );

      const ids = new Set(results.map((result) => result.request.requestId));
      expect(ids.size).toBe(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(await connection.db.select().from(subRequests)).toHaveLength(1);
      expect(await connection.db.select().from(subRequestEvents)).toHaveLength(1);
      expect(await connection.db.select().from(emailOutbox)).toHaveLength(1);
    }
  );
  dbTest(
    "refuses a second live request for one injured player, naming the index it broke",
    async ({ database }) => {
      const { db } = database.connection;
      const requestedBy = await insertInventedUser(db, 5);
      await createRequest(db, creation(newRequest(requestedBy), false));

      const failure = await createRequest(db, creation(newRequest(requestedBy), false)).catch(
        (error: unknown) => error
      );

      expect(violatedUniqueIndex(failure)).toBe("sub_requests_active_injured_unique");
      expect(violatedUniqueIndex(new Error("not a database failure"))).toBeNull();
    }
  );
});

describe("findActiveRequest", () => {
  dbTest(
    "finds the injured player's live request, ignoring freed and proving ones",
    async ({ database }) => {
      const { db } = database.connection;
      const requestedBy = await insertInventedUser(db, 5);
      const where = { season: 2027, matchupPeriodId: 3, teamId: 5, injuredPlayerId: 2 };
      await createRequest(db, creation(newRequest(requestedBy, { status: "withdrawn" }), false));
      await createRequest(
        db,
        creation(newRequest(requestedBy, { kind: "proving", status: "completed" }), false)
      );
      expect(await findActiveRequest(db, where)).toBeNull();

      const live = newRequest(requestedBy);
      await createRequest(db, creation(live, false));
      expect((await findActiveRequest(db, where))?.requestId).toBe(live.requestId);
      expect(await findActiveRequest(db, { ...where, matchupPeriodId: 4 })).toBeNull();
    }
  );
});

describe("listActiveTeamRequests", () => {
  dbTest(
    "lists the team's requests this matchup that still hold their injured players",
    async ({ database }) => {
      const { db } = database.connection;
      const requestedBy = await insertInventedUser(db, 5);
      const where = { season: 2027, matchupPeriodId: 3, teamId: 5 };
      const live = [
        newRequest(requestedBy, { status: "completed" }),
        newRequest(requestedBy, { injuredPlayerId: 3, status: "reversed" }),
      ];
      const others = [
        newRequest(requestedBy, { injuredPlayerId: 4, status: "rejected" }),
        newRequest(requestedBy, { injuredPlayerId: 5, kind: "proving" }),
        newRequest(requestedBy, { injuredPlayerId: 6, matchupPeriodId: 4 }),
        newRequest(requestedBy, { injuredPlayerId: 7, season: 2026 }),
        newRequest(requestedBy, { injuredPlayerId: 8, teamId: 6 }),
      ];
      for (const request of [...live, ...others]) {
        await createRequest(db, creation(request, false));
      }

      const ids = (await listActiveTeamRequests(db, where)).map((row) => row.requestId);
      expect(ids.sort()).toEqual(live.map((request) => request.requestId).sort());
    }
  );
});

describe("listTeamRequests", () => {
  dbTest(
    "lists one team's requests newest first, without proving requests",
    async ({ database }) => {
      const { db } = database.connection;
      const requestedBy = await insertInventedUser(db, 5);
      const older = newRequest(requestedBy, { status: "rejected", createdAt: minutesFromNow(-60) });
      const newer = newRequest(requestedBy, { injuredPlayerId: 3 });
      await createRequest(db, creation(older, false));
      await createRequest(db, creation(newer, false));
      await createRequest(
        db,
        creation(newRequest(requestedBy, { teamId: 6, injuredPlayerId: 3 }), false)
      );
      await createRequest(
        db,
        creation(newRequest(requestedBy, { kind: "proving", injuredPlayerId: 4 }), false)
      );

      const ids = (await listTeamRequests(db, 5)).map((row) => row.requestId);
      expect(ids).toEqual([newer.requestId, older.requestId]);
    }
  );
});

describe("listCommissionerQueue", () => {
  dbTest(
    "lists every team's requests, those needing action first and oldest of them first",
    async ({ database }) => {
      const { db } = database.connection;
      const requestedBy = await insertInventedUser(db, 5);
      const done = newRequest(requestedBy, { status: "completed", createdAt: minutesFromNow(-10) });
      const waitingNew = newRequest(requestedBy, {
        status: "awaiting_approval",
        teamId: 6,
        createdAt: minutesFromNow(-5),
      });
      const waitingOld = newRequest(requestedBy, {
        status: "needs_review",
        teamId: 7,
        createdAt: minutesFromNow(-30),
      });
      for (const request of [done, waitingNew, waitingOld])
        await createRequest(db, creation(request, false));

      const ids = (await listCommissionerQueue(db)).map((row) => row.requestId);
      expect(ids).toEqual([waitingOld.requestId, waitingNew.requestId, done.requestId]);
    }
  );

  dbTest("leaves proving requests out, waiting or settled", async ({ database }) => {
    const { db } = database.connection;
    const requestedBy = await insertInventedUser(db, 1);
    const real = newRequest(requestedBy, { status: "awaiting_approval" });
    const provingWaiting = newRequest(requestedBy, {
      kind: "proving",
      status: "awaiting_approval",
      injuredPlayerId: 3,
    });
    const provingDone = newRequest(requestedBy, {
      kind: "proving",
      status: "completed",
      injuredPlayerId: 4,
    });
    for (const request of [real, provingWaiting, provingDone])
      await createRequest(db, creation(request, false));

    const ids = (await listCommissionerQueue(db)).map((row) => row.requestId);
    expect(ids).toEqual([real.requestId]);
  });
});

describe("listProvingRequests", () => {
  dbTest("lists only proving requests, newest first", async ({ database }) => {
    const { db } = database.connection;
    const requestedBy = await insertInventedUser(db, 1);
    const older = newRequest(requestedBy, {
      kind: "proving",
      status: "completed",
      createdAt: minutesFromNow(-60),
    });
    const newer = newRequest(requestedBy, { kind: "proving", injuredPlayerId: 3 });
    const real = newRequest(requestedBy, { injuredPlayerId: 4 });
    for (const request of [older, newer, real]) await createRequest(db, creation(request, false));

    const ids = (await listProvingRequests(db)).map((row) => row.requestId);
    expect(ids).toEqual([newer.requestId, older.requestId]);
  });
});

describe("getRequestDetail", () => {
  dbTest(
    "gives a request with its snapshots and events in order, or null for none",
    async ({ database }) => {
      const { db } = database.connection;
      const request = newRequest(await insertInventedUser(db, 5));
      await createRequest(db, creation(request, false));

      const detail = await getRequestDetail(db, request.requestId);
      expect(detail?.request.requestId).toBe(request.requestId);
      expect(detail?.snapshots.map((row) => row.phase)).toEqual(["request"]);
      expect(detail?.events.map((row) => row.eventType)).toEqual(["request_filed"]);
      expect(await getRequestDetail(db, randomUUID())).toBeNull();
    }
  );
});

describe("transitionRequest", () => {
  dbTest(
    "applies a change once at the request's version, and refuses a stale one",
    async ({ database }) => {
      const { db } = database.connection;
      const request = newRequest(await insertInventedUser(db, 5));
      await createRequest(db, creation(request, false));
      const change = {
        requestId: request.requestId,
        fromStatus: "needs_review" as const,
        version: 0,
        patch: { status: "rejected" as const, reviewReason: null },
        now: minutesFromNow(1),
      };

      expect(await transitionRequest(db, change)).toMatchObject({ status: "rejected", version: 1 });
      expect(await transitionRequest(db, change)).toBeNull();
    }
  );

  dbTest(
    "lets only one of two simultaneous actions on one version take effect",
    async ({ database }) => {
      const { db } = database.connection;
      const request = newRequest(await insertInventedUser(db, 5), {
        status: "awaiting_approval",
        reviewReason: null,
      });
      await createRequest(db, creation(request, false));
      const at = {
        requestId: request.requestId,
        fromStatus: "awaiting_approval" as const,
        version: 0,
        now,
      };

      const results = await Promise.all([
        transitionRequest(db, { ...at, patch: { status: "queued" } }),
        transitionRequest(db, { ...at, patch: { status: "rejected" } }),
      ]);

      expect(results.filter((row) => row !== null)).toHaveLength(1);
      const [stored] = await db.select().from(subRequests);
      expect(stored?.version).toBe(1);
    }
  );
});

describe("listWaitingRequests", () => {
  dbTest("lists requests waiting for approval or execution, oldest first", async ({ database }) => {
    const { db } = database.connection;
    const requestedBy = await insertInventedUser(db, 5);
    const queued = newRequest(requestedBy, { status: "queued", createdAt: minutesFromNow(-5) });
    const waiting = newRequest(requestedBy, {
      status: "awaiting_approval",
      teamId: 6,
      createdAt: minutesFromNow(-30),
    });
    const inReview = newRequest(requestedBy, { teamId: 7 });
    for (const request of [queued, waiting, inReview])
      await createRequest(db, creation(request, false));

    const ids = (await listWaitingRequests(db)).map((row) => row.requestId);
    expect(ids).toEqual([waiting.requestId, queued.requestId]);
  });
});

describe("findEarlierCreditingRequest", () => {
  // Player 20 came in for player 2 in an earlier request; now he is the injured starter.
  const laterFields = {
    injuredPlayerId: 20,
    replacementPlayerId: 21,
    status: "executing" as const,
  };

  async function findFor(
    db: DatabaseExecutor,
    earlierFields: Partial<NewSubRequest>,
    laterOverrides: Partial<NewSubRequest> = {}
  ) {
    const requestedBy = await insertInventedUser(db, 5);
    const earlier = newRequest(requestedBy, {
      injuredPlayerId: 2,
      replacementPlayerId: 20,
      createdAt: minutesFromNow(-30),
      ...earlierFields,
    });
    const later = newRequest(requestedBy, { ...laterFields, ...laterOverrides });
    await createRequest(db, creation(earlier, false));
    await createRequest(db, creation(later, false));
    return { earlier, found: await findEarlierCreditingRequest(db, { ...later, createdAt: now }) };
  }

  dbTest.for([
    { status: "completed", lineupState: "verified" },
    { status: "completed_manually", lineupState: "pending" },
    { status: "needs_review", lineupState: "verified" },
    { status: "executing", lineupState: "verified" },
    // He is the later request's starter, so that swap reached ESPN some way, whatever the
    // earlier request's record says of its lineup.
    { status: "needs_review", lineupState: "pending" },
    { status: "needs_review", lineupState: "failed" },
    { status: "awaiting_approval", lineupState: "pending" },
  ] as const)(
    "finds an earlier request that put this player in, $status with its lineup $lineupState",
    async (fields, { database }) => {
      const { earlier, found } = await findFor(database.connection.db, fields);

      expect(found?.requestId).toBe(earlier.requestId);
    }
  );

  dbTest.for([
    { label: "reversed", fields: { status: "reversed", lineupState: "verified" } },
    { label: "rejected", fields: { status: "rejected", lineupState: "failed" } },
    { label: "withdrawn", fields: { status: "withdrawn", lineupState: "pending" } },
    { label: "refused", fields: { status: "refused", lineupState: "pending" } },
    {
      label: "a rehearsal",
      fields: { status: "completed", lineupState: "pending", isRehearsal: true },
    },
    {
      label: "a proving run",
      fields: { status: "completed", lineupState: "verified", kind: "proving" },
    },
  ] as const)(
    "never counts an earlier request that was $label",
    async ({ fields }, { database }) => {
      const { found } = await findFor(database.connection.db, fields);

      expect(found).toBeNull();
    }
  );

  dbTest.for([{ teamId: 6 }, { matchupPeriodId: 2 }])(
    "never counts a settled request of another team or week (%o)",
    async (elsewhere, { database }) => {
      const settled = { status: "completed" as const, lineupState: "verified" as const };

      const { found } = await findFor(database.connection.db, { ...settled, ...elsewhere });

      expect(found).toBeNull();
    }
  );
});
