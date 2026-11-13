import { randomUUID } from "node:crypto";
import { createLogger } from "@injurysub/config";
import {
  acquireWriteLease,
  createRequest,
  type DatabaseConnection,
  emailOutbox,
  getEspnAccess,
  getRequestDetail,
  type NewSubRequest,
  releaseWriteLease,
  userAccounts,
  writeLeagueSettings,
} from "@injurysub/db";
import { type LineupMove, planRecord } from "@injurysub/domain";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { createFakeEspn, type FakeEspn } from "../fake-espn";
import { dbTest } from "../test-support";
import { runExecutorPass } from "./executor";
import { type ExecutorContext, preflightRequest } from "./preflight";

// Team 1 as the recordings hold it (ESPN's day 8, matchup period 2): Towns at C, Tatum at F,
// Clingan at F/C; Sharpe (C, F/C) and Larsson (F) on the bench. Nobody is OUT until a test says.
const TEAM = 1;
const TOWNS = 3136195;
const SHARPE = 4432194;
const TATUM = 4065648;
const LARSSON = 4601025;
const CLINGAN = 5105565;
// Lillard at G; Edey (a center) on the bench takes a UTIL once a UTIL starter who can play G moves
// to Lillard's slot. Of the two UTIL starters, only the guard can.
const LILLARD = 6606;
const EDEY = 4600663;
const UTIL_GUARD = 4900671;
const UTIL_FORWARD = 4278562;
const lillardForEdey = {
  injuredPlayerId: LILLARD,
  injuredName: "Damian Lillard",
  injuredSlot: "G",
  replacementPlayerId: EDEY,
  replacementName: "Zach Edey",
};
const utilGuardMoves: LineupMove[] = [
  { playerId: LILLARD, fromSlot: "G", toSlot: "BE" },
  { playerId: UTIL_GUARD, fromSlot: "UTIL", toSlot: "G" },
  { playerId: EDEY, fromSlot: "BE", toSlot: "UTIL" },
];

const now = new Date("2026-10-27T20:00:00.000Z");
const minutesFrom = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Setup = {
  connection: DatabaseConnection;
  fake: FakeEspn;
  commissioner: string;
  matchupId: number;
};

// The commissioner (team 1, invented), automation on for `allowlist` in auto mode, and the fake.
async function setUp(connection: DatabaseConnection, allowlist = [TEAM]): Promise<Setup> {
  const commissioner = randomUUID();
  await connection.db.insert(userAccounts).values({
    userId: commissioner,
    email: `commissioner-${commissioner}@example.test`,
    teamId: TEAM,
    displayName: "Invented Commissioner",
    role: "commissioner",
  });
  await writeLeagueSettings(connection.db, {
    executionMode: "auto",
    writeAllowlist: allowlist,
    updatedBy: commissioner,
    now,
    shownUpdatedAt: null,
  });
  const fake = await createFakeEspn();
  vi.stubGlobal("fetch", fake.fetch);
  const { matchup } = await fake.read.getTeamWeek(TEAM);
  if (matchup === null) throw new Error("team 1 has no recorded matchup");
  return { connection, fake, commissioner, matchupId: matchup.matchupId };
}

// A queued request on team 1: Towns out, Sharpe in, filed an hour ago and expiring in 11 hours.
function queuedRequest(setup: Setup, overrides: Partial<NewSubRequest>): NewSubRequest {
  return {
    requestId: randomUUID(),
    kind: "substitution",
    teamId: TEAM,
    season: 2027,
    matchupPeriodId: 2,
    matchupId: setup.matchupId,
    requestedBy: setup.commissioner,
    idempotencyKey: randomUUID(),
    injuredPlayerId: TOWNS,
    injuredName: "Karl-Anthony Towns",
    injuredSlot: "C",
    replacementPlayerId: SHARPE,
    replacementName: "Day'Ron Sharpe",
    requestMoment: minutesFrom(now, -60),
    filedAt: minutesFrom(now, -60),
    requestDay: 8,
    designationAtRequest: "OUT",
    status: "queued",
    executionModeAtRequest: "auto",
    expiresAt: minutesFrom(now, 11 * 60),
    projectedAdjustmentTenths: 0,
    createdAt: minutesFrom(now, -60),
    ...overrides,
  };
}

// The request snapshot holds the edit confirmed when `plan` is given, as Confirm records it.
async function insertQueued(
  setup: Setup,
  overrides: Partial<NewSubRequest> = {},
  plan: LineupMove[] | null = null
) {
  const request = queuedRequest(setup, overrides);
  const confirmed = plan === null ? {} : planRecord({ items: plan, movedStarters: 1 });
  await createRequest(setup.connection.db, {
    request,
    snapshot: {
      snapshotId: randomUUID(),
      espnDay: 8,
      takenAt: request.createdAt ?? now,
      payload: { lineup: { teamId: TEAM, teamName: "Invented Hoopers" }, ...confirmed },
    },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: setup.commissioner,
      eventType: "request_filed",
      payload: {},
      createdAt: request.createdAt ?? now,
    },
    email: null,
  });
  return request.requestId;
}

function contextFor(setup: Setup, at: Date = now): ExecutorContext {
  return {
    connection: setup.connection,
    espn: setup.fake.read,
    holder: "worker-under-test",
    now: at,
    logger: createLogger("worker"),
  };
}

async function detailOf(setup: Setup, requestId: string) {
  const detail = await getRequestDetail(setup.connection.db, requestId);
  if (detail === null) throw new Error(`request ${requestId} is gone`);
  return detail;
}

async function outbox(setup: Setup) {
  return setup.connection.db.select().from(emailOutbox);
}

// Gate 2 at preflight: nothing read, nothing sent, the reason recorded (AC2-3).
async function expectGateReview(
  connection: DatabaseConnection,
  allowlist: number[],
  reason: "automation_off" | "not_allowlisted"
) {
  const setup = await setUp(connection, allowlist);
  setup.fake.setDesignation(TOWNS, "OUT");
  const requestId = await insertQueued(setup);

  expect(await runExecutorPass(contextFor(setup))).toEqual({ kind: "sent_to_review", reason });
  expect((await detailOf(setup, requestId)).request.reviewReason).toBe(reason);
  expect(setup.fake.posts).toEqual([]);
}

describe("the executor's pass", () => {
  dbTest(
    "claims the oldest queued request once its preflight passes, leaving the next queued",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.setDesignation(TATUM, "OUT");
      const older = await insertQueued(setup, { createdAt: minutesFrom(now, -120) });
      const newer = await insertQueued(setup, {
        injuredPlayerId: TATUM,
        injuredSlot: "F",
        replacementPlayerId: LARSSON,
      });

      const result = await runExecutorPass(contextFor(setup));

      expect(result).toMatchObject({ kind: "claimed", resumeAt: "lineup" });
      const claimed = await detailOf(setup, older);
      expect(claimed.request.status).toBe("executing");
      expect(claimed.events.map((event) => event.eventType)).toEqual(["request_filed", "claimed"]);
      expect(claimed.events.at(-1)?.payload).toMatchObject({
        resumeAt: "lineup",
        espnDay: 8,
        items: [
          { playerId: TOWNS, fromSlot: "C", toSlot: "BE" },
          { playerId: SHARPE, fromSlot: "BE", toSlot: "C" },
        ],
      });
      expect((await detailOf(setup, newer)).request.status).toBe("queued");
    }
  );

  dbTest("claims nothing while another worker holds the lease", async ({ database }) => {
    const setup = await setUp(database.connection);
    setup.fake.setDesignation(TOWNS, "OUT");
    const requestId = await insertQueued(setup);
    await acquireWriteLease(database.connection.db, { holder: "another-worker", ttlSeconds: 60 });

    expect(await runExecutorPass(contextFor(setup))).toEqual({ kind: "lease_held" });
    expect((await detailOf(setup, requestId)).request.status).toBe("queued");
  });

  dbTest("claims nothing once another worker has taken the lease over", async ({ database }) => {
    const setup = await setUp(database.connection);
    setup.fake.setDesignation(TOWNS, "OUT");
    const requestId = await insertQueued(setup);
    const { db } = database.connection;
    const lost = await acquireWriteLease(db, { holder: "worker-under-test", ttlSeconds: 60 });
    if (lost === null) throw new Error("expected the first lease");
    await releaseWriteLease(db, lost);
    await acquireWriteLease(db, { holder: "another-worker", ttlSeconds: 60 });

    const queued = (await detailOf(setup, requestId)).request;
    const result = await preflightRequest({ ...contextFor(setup), lease: lost }, queued);

    expect(result).toEqual({ kind: "lost" });
    expect((await detailOf(setup, requestId)).request.status).toBe("queued");
  });

  dbTest(
    "sends a request whose starter is no longer OUT to review as stale, writing nothing",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertQueued(setup);

      expect(await runExecutorPass(contextFor(setup))).toEqual({
        kind: "sent_to_review",
        reason: "stale",
      });

      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "needs_review", reviewReason: "stale" });
      expect(events.at(-1)).toMatchObject({
        eventType: "sent_to_review",
        payload: { reason: "stale", detail: "designation_changed" },
      });
      expect(setup.fake.posts).toEqual([]);
      expect((await outbox(setup)).map((email) => email.subject)).toEqual([
        "InjurySub: Invented Hoopers needs you",
      ]);
    }
  );

  dbTest(
    "sends a request whose replacement already left the bench to review as stale",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      // An earlier swap put Sharpe in at F/C for Clingan.
      await setup.fake.write.applyLineup(
        {
          teamId: TEAM,
          scoringPeriodId: 8,
          moves: [
            { playerId: CLINGAN, fromSlot: "F/C", toSlot: "BE" },
            { playerId: SHARPE, fromSlot: "BE", toSlot: "F/C" },
          ],
        },
        { allowlist: new Set([TEAM]), beforeSend: async () => {} }
      );

      await runExecutorPass(contextFor(setup));

      const { events, request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "needs_review", reviewReason: "stale" });
      expect(events.at(-1)?.payload).toEqual({ reason: "stale", detail: "no_automatable_edit" });
      expect(setup.fake.posts).toHaveLength(1);
    }
  );

  dbTest(
    "sends the confirmed one-move edit while the lineup still gives it, recording it on the claim",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(LILLARD, "OUT");
      const requestId = await insertQueued(setup, lillardForEdey, utilGuardMoves);

      expect(await runExecutorPass(contextFor(setup))).toMatchObject({ kind: "claimed" });

      const claimed = (await detailOf(setup, requestId)).events.at(-1);
      expect(claimed?.eventType).toBe("claimed");
      expect(claimed?.payload).toMatchObject({ items: utilGuardMoves, movedStarters: 1 });
      expect(claimed?.payload).not.toHaveProperty("confirmedItems");
    }
  );

  dbTest(
    "sends the one-move edit that fits now when another starter moved, keeping the confirmed one beside it",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(LILLARD, "OUT");
      // Confirmed when the UTIL forward could still move to G.
      const confirmed: LineupMove[] = [
        { playerId: LILLARD, fromSlot: "G", toSlot: "BE" },
        { playerId: UTIL_FORWARD, fromSlot: "UTIL", toSlot: "G" },
        { playerId: EDEY, fromSlot: "BE", toSlot: "UTIL" },
      ];
      const requestId = await insertQueued(setup, lillardForEdey, confirmed);

      expect(await runExecutorPass(contextFor(setup))).toMatchObject({ kind: "claimed" });

      const { request, events } = await detailOf(setup, requestId);
      expect(request.status).toBe("executing");
      expect(events.at(-1)?.payload).toMatchObject({
        items: utilGuardMoves,
        confirmedItems: confirmed,
      });
    }
  );

  dbTest(
    "re-derives and sends the edit for a request filed before plans were kept",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(LILLARD, "OUT");
      const requestId = await insertQueued(setup, lillardForEdey);

      expect(await runExecutorPass(contextFor(setup))).toMatchObject({ kind: "claimed" });

      const claimed = (await detailOf(setup, requestId)).events.at(-1);
      expect(claimed?.payload).toMatchObject({ items: utilGuardMoves });
      expect(claimed?.payload).not.toHaveProperty("confirmedItems");
    }
  );

  dbTest("keeps a snapshot of the lineup its preflight checked", async ({ database }) => {
    const setup = await setUp(database.connection);
    setup.fake.setDesignation(TOWNS, "OUT");
    const requestId = await insertQueued(setup);

    await runExecutorPass(contextFor(setup));

    const preflight = (await detailOf(setup, requestId)).snapshots.find(
      (snapshot) => snapshot.phase === "preflight"
    );
    expect(preflight).toMatchObject({ espnDay: 8, takenAt: now });
    expect(JSON.stringify(preflight?.payload)).toContain(`"playerId":${TOWNS}`);
    expect(preflight?.payload).toMatchObject({ lineup: { teamId: TEAM } });
  });

  dbTest(
    "keeps a request queued while ESPN refuses the cookie, and emails the commissioner once",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertQueued(setup);
      const before = (await detailOf(setup, requestId)).request.version;
      setup.fake.failReads("credentials_rejected");

      const first = await runExecutorPass(contextFor(setup));
      const second = await runExecutorPass(contextFor(setup, minutesFrom(now, 1)));

      expect([first, second]).toEqual([
        { kind: "blocked", code: "credentials_rejected" },
        { kind: "blocked", code: "credentials_rejected" },
      ]);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "queued",
        version: before,
      });
      expect(await getEspnAccess(database.connection.db)).toMatchObject({
        state: "credentials_rejected",
        since: now,
      });
      expect((await outbox(setup)).map((email) => email.subject)).toEqual([
        "InjurySub: ESPN refused the cookie",
      ]);
    }
  );

  dbTest(
    "re-checks a request once ESPN reads again, and sends one past its expiry to review",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      setup.fake.failReads("credentials_rejected");
      await runExecutorPass(contextFor(setup));
      setup.fake.failReads(null);

      const result = await runExecutorPass(contextFor(setup, minutesFrom(now, 12 * 60)));

      expect(result).toEqual({ kind: "sent_to_review", reason: "expired" });
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "needs_review",
        reviewReason: "expired",
      });
    }
  );

  dbTest(
    "resumes a re-approved held adjustment at the adjustment, never re-checking the swap",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertQueued(setup, { lineupState: "verified" });

      const result = await runExecutorPass(contextFor(setup));

      expect(result).toMatchObject({ kind: "claimed", resumeAt: "adjustment" });
      expect((await detailOf(setup, requestId)).request.status).toBe("executing");
    }
  );

  dbTest("passes an approved suspension on SUSPENSION", async ({ database }) => {
    const setup = await setUp(database.connection);
    setup.fake.setDesignation(TOWNS, "SUSPENSION");
    await insertQueued(setup, { designationAtRequest: "SUSPENSION" });

    expect(await runExecutorPass(contextFor(setup))).toMatchObject({
      kind: "claimed",
      resumeAt: "lineup",
    });
  });

  dbTest(
    "passes an on-behalf request on ESPN's designation at its filing",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertQueued(setup, {
        kind: "on_behalf",
        designationAtRequest: "OUT",
        designationAtFiling: "ACTIVE",
      });

      expect(await runExecutorPass(contextFor(setup))).toMatchObject({
        kind: "claimed",
        resumeAt: "lineup",
      });
    }
  );

  dbTest("sends a queued request to review when automation is off", async ({ database }) => {
    await expectGateReview(database.connection, [], "automation_off");
  });

  dbTest(
    "sends a queued request to review when its team is off the allowlist",
    async ({ database }) => {
      await expectGateReview(database.connection, [2], "not_allowlisted");
    }
  );
});
