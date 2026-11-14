import { randomUUID } from "node:crypto";
import {
  acquireWriteLease,
  appendEvent,
  type DatabaseConnection,
  getEspnAccess,
  type NewSubRequest,
  releaseWriteLease,
  type WriteAttemptRecord,
} from "@injurysub/db";
import {
  adjustmentReasonEntry,
  computedLinesOf,
  type LineupMove,
  planLineupEdit,
} from "@injurysub/domain";
import type { TeamWeekRead } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { sweepWaitingRequests } from "../expiry";
import { dbTest } from "../test-support";
import { recordNotSent, sendsLeft, sendWrite } from "./espn-write";
import { runExecutorPass } from "./executor";
import { runLineupStep } from "./lineup-step";
import { type ExecutorContext, preflightRequest } from "./preflight";
import {
  attemptsOf,
  CLINGAN,
  claimedAndStopped,
  claimForLineup,
  contextFor,
  detailOf,
  EDEY,
  insertQueued,
  insertTatumRequest,
  LARSSON,
  LILLARD,
  lillardForEdey,
  minutesFrom,
  now,
  outbox,
  postedPlayers,
  queuedRequest,
  recordedMatchup,
  rehearsingContextFor,
  type Setup,
  SHARPE,
  sendingContextFor,
  sendThenStop,
  setSide,
  setUp,
  sideOf,
  slotsOn,
  TATUM,
  TATUM_OWED,
  TEAM,
  TOWNS,
  takeTeamOffAllowlist,
  tatumForLarsson,
  UTIL_FORWARD,
  UTIL_GUARD,
  utilGuardMoves,
} from "./test-support";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  // ESPN read again just before the claim answers differently from preflight's read.
  async function expectLeftQueued(
    setup: Setup,
    requestId: string,
    espn: ExecutorContext["espn"],
    what: "day" | "week" | "edit"
  ) {
    const before = (await detailOf(setup, requestId)).request;

    expect(await runExecutorPass({ ...contextFor(setup), espn })).toEqual({
      kind: "changed",
      what,
    });

    const { request, events } = await detailOf(setup, requestId);
    expect(request).toMatchObject({ status: "queued", version: before.version });
    expect(events.map((event) => event.eventType)).toEqual(["request_filed"]);
  }

  dbTest(
    "claims nothing when ESPN's day has moved on since preflight's read, leaving the request queued",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        getLineup: async (teamId) => {
          const read = await setup.fake.read.getLineup(teamId);
          return { ...read, meta: { ...read.meta, scoringPeriodId: 9 } };
        },
      };

      await expectLeftQueued(setup, requestId, espn, "day");
      expect(setup.fake.posts).toEqual([]);
    }
  );

  dbTest(
    "claims nothing when ESPN's week has moved on since preflight's read",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        getLineup: async (teamId) => {
          const read = await setup.fake.read.getLineup(teamId);
          return { ...read, meta: { ...read.meta, matchupPeriodId: 3 } };
        },
      };

      await expectLeftQueued(setup, requestId, espn, "week");
    }
  );

  dbTest(
    "claims nothing when a player of the edit moved on ESPN since preflight's read",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      // Right after preflight's read, someone makes the same swap on ESPN by hand, so the edit
      // preflight worked out no longer fits the lineup.
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        getTeamWeek: async (teamId) => {
          const read = await setup.fake.read.getTeamWeek(teamId);
          await setup.fake.write.applyLineup(
            {
              teamId: TEAM,
              scoringPeriodId: 8,
              moves: [
                { playerId: TOWNS, fromSlot: "C", toSlot: "BE" },
                { playerId: SHARPE, fromSlot: "BE", toSlot: "C" },
              ],
            },
            { allowlist: new Set([TEAM]), beforeSend: async () => {} }
          );
          return read;
        },
      };

      await expectLeftQueued(setup, requestId, espn, "edit");
      expect(setup.fake.posts).toHaveLength(1);
    }
  );

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
    "sends a request whose matchup has ended to review as week_ended, though its plan still holds",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      // Filed for matchup period 1; ESPN is on period 2.
      const requestId = await insertQueued(setup, { matchupPeriodId: 1 });

      expect(await runExecutorPass(contextFor(setup))).toEqual({
        kind: "sent_to_review",
        reason: "week_ended",
      });

      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "needs_review", reviewReason: "week_ended" });
      expect(events.map((event) => event.eventType)).not.toContain("claimed");
      expect(setup.fake.posts).toEqual([]);
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

describe("the lineup step", () => {
  dbTest(
    "sends a direct swap once, after its attempt is recorded, and verifies it from ESPN's day on",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      const recordedAtSend: WriteAttemptRecord[][] = [];
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        recordedAtSend.push(await attemptsOf(setup, requestId));
        return setup.fake.fetch(input, init);
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      // Nothing is owed for Towns (no points before day 8), so the pass completes the request.
      expect(result).toMatchObject({ kind: "completed" });
      expect(setup.fake.posts).toHaveLength(1);
      expect(postedPlayers(setup)).toEqual([TOWNS, SHARPE]);
      expect(recordedAtSend).toEqual([[expect.objectContaining({ status: "sending" })]]);
      const { request, events, snapshots } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ lineupState: "verified", effectiveDay: 8 });
      expect(events.map((event) => event.eventType)).toEqual([
        "request_filed",
        "claimed",
        "lineup_sent",
        "lineup_verified",
        "completed",
      ]);
      expect(snapshots.map((snapshot) => snapshot.phase)).toContain("lineup_verified");
      expect(await slotsOn(setup, 13, TOWNS, SHARPE)).toEqual(["BE", "C"]);
    }
  );

  dbTest(
    "takes the effective day from the first day ESPN shows the swap, not from the body's day",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.applyLineupFrom(9);
      const requestId = await insertQueued(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed" });
      expect((await detailOf(setup, requestId)).request.effectiveDay).toBe(9);
    }
  );

  dbTest(
    "sends a swap ESPN applied only in part to the commissioner as ambiguous, with no adjustment",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.skipLineupItems([1]);
      const requestId = await insertQueued(setup);

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({
        kind: "sent_to_review",
        reason: "ambiguous",
      });

      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "needs_review",
        reviewReason: "ambiguous",
        lineupState: "ambiguous",
        adjustmentState: "pending",
        effectiveDay: null,
      });
      expect((await attemptsOf(setup, requestId))[0]?.outcome).toBe("ambiguous");
      expect((await outbox(setup)).map((email) => email.subject)).toEqual([
        "InjurySub: Invented Hoopers needs you",
      ]);
    }
  );

  dbTest(
    "sends a one-move rearrangement as one write of three items, the edit that fits now, and verifies all three",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(LILLARD, "OUT");
      // Confirmed when the UTIL forward could still move to G; now only the UTIL guard can.
      const confirmed: LineupMove[] = [
        { playerId: LILLARD, fromSlot: "G", toSlot: "BE" },
        { playerId: UTIL_FORWARD, fromSlot: "UTIL", toSlot: "G" },
        { playerId: EDEY, fromSlot: "BE", toSlot: "UTIL" },
      ];
      const requestId = await insertQueued(setup, lillardForEdey, confirmed);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed" });
      expect((await detailOf(setup, requestId)).request.effectiveDay).toBe(8);
      expect(setup.fake.posts).toHaveLength(1);
      expect(postedPlayers(setup)).toEqual([LILLARD, UTIL_GUARD, EDEY]);
      expect(await slotsOn(setup, 13, LILLARD, UTIL_GUARD, EDEY)).toEqual(["BE", "G", "UTIL"]);
    }
  );

  dbTest(
    "sends a rearrangement whose moved starter stayed where he was to the commissioner as ambiguous",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(LILLARD, "OUT");
      setup.fake.skipLineupItems([1]);
      const requestId = await insertQueued(setup, lillardForEdey, utilGuardMoves);

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({
        kind: "sent_to_review",
        reason: "ambiguous",
      });
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("ambiguous");
    }
  );

  // B14, 2026-11-14: ESPN refused a live swap and the record kept only the HTTP status.
  dbTest("keeps ESPN's reason for a refused write on the write's answer", async ({ database }) => {
    const setup = await setUp(database.connection);
    setup.fake.setDesignation(TOWNS, "OUT");
    setup.fake.answerWrites("lineup", "refuse");
    const requestId = await insertQueued(setup);

    await runExecutorPass(sendingContextFor(setup));

    const { events } = await detailOf(setup, requestId);
    const sent = events.find((event) => event.eventType === "lineup_sent");
    expect(sent?.payload).toMatchObject({
      failureCode: "write_refused",
      espnAnswer: "HTTP 400 FAKE_REFUSED",
    });
  });

  dbTest(
    "sends a swap ESPN refused to the commissioner as lineup_failed, to make by hand",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.answerWrites("lineup", "refuse");
      const requestId = await insertQueued(setup);

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({
        kind: "sent_to_review",
        reason: "lineup_failed",
      });

      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ reviewReason: "lineup_failed", lineupState: "failed" });
      expect(await attemptsOf(setup, requestId)).toEqual([
        expect.objectContaining({
          status: "failed",
          failureCode: "write_refused",
          outcome: "not_applied",
        }),
      ]);
      expect(await outbox(setup)).toHaveLength(1);
    }
  );

  dbTest(
    "sends nothing, and records no attempt, once another worker has taken the lease over",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      const { lease, claimed } = await claimForLineup(setup, requestId);
      const { db } = setup.connection;
      await releaseWriteLease(db, lease);
      await acquireWriteLease(db, { holder: "another-worker", ttlSeconds: 60 });

      const result = await runLineupStep(
        { ...sendingContextFor(setup), lease, write: setup.fake.write },
        claimed
      );

      expect(result).toEqual({ kind: "lost" });
      expect(setup.fake.posts).toEqual([]);
      expect(await attemptsOf(setup, requestId)).toEqual([]);
    }
  );

  dbTest(
    "keeps the attempt with its body, fencing token, answer, times and what ESPN showed after",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      const { lease, claimed } = await claimForLineup(setup, requestId);

      await runLineupStep({ ...sendingContextFor(setup), lease, write: setup.fake.write }, claimed);

      const [attempt] = await attemptsOf(setup, requestId);
      expect(attempt).toMatchObject({
        kind: "lineup",
        teamId: TEAM,
        scoringPeriodId: 8,
        body: setup.fake.posts[0]?.body,
        fencingToken: lease.token,
        status: "answered",
        failureCode: null,
        outcome: "verified",
      });
      expect(attempt?.respondedAt).toBeInstanceOf(Date);
      expect(attempt?.readBackAt).toBeInstanceOf(Date);
      expect(attempt?.readback).toContainEqual({
        scoringPeriodId: 13,
        state: "applied",
        slots: { [TOWNS]: "BE", [SHARPE]: "C" },
      });
    }
  );

  dbTest(
    "never verifies a swap ESPN answered 200 to but didn't apply: it reads every round, then lineup_failed",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.answerWrites("lineup", "ignore");
      const requestId = await insertQueued(setup);
      const pauses: number[] = [];

      const result = await runExecutorPass({
        ...sendingContextFor(setup),
        sleep: async (ms) => {
          pauses.push(ms);
        },
      });

      expect(result).toEqual({ kind: "sent_to_review", reason: "lineup_failed" });
      expect(pauses).toEqual([2000, 2000, 2000, 2000]);
      expect(await attemptsOf(setup, requestId)).toEqual([
        expect.objectContaining({ status: "answered", outcome: "not_applied" }),
      ]);
    }
  );

  dbTest(
    "leaves a swap unsettled when ESPN went unreadable after one early read that didn't show it yet",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.answerWrites("lineup", "ignore");
      const requestId = await insertQueued(setup);

      // The first round reads ESPN untouched; every later round can't be read.
      const result = await runExecutorPass({
        ...sendingContextFor(setup),
        sleep: async () => setup.fake.failReads("espn_unavailable"),
      });

      expect(result).toEqual({ kind: "unsettled" });
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "executing", lineupState: "sent" });
      expect(await attemptsOf(setup, requestId)).toEqual([
        expect.objectContaining({ status: "answered", outcome: null }),
      ]);
      expect(await outbox(setup)).toEqual([]);
    }
  );

  dbTest(
    "verifies a swap from ESPN's lineup when the answer was lost after ESPN applied it",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.answerWrites("lineup", "lose_answer");
      const requestId = await insertQueued(setup);

      expect(await runExecutorPass(sendingContextFor(setup))).toMatchObject({
        kind: "completed",
      });
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("verified");
      expect(await attemptsOf(setup, requestId)).toEqual([
        expect.objectContaining({
          status: "failed",
          failureCode: "outcome_unknown",
          outcome: "verified",
        }),
      ]);
    }
  );

  dbTest(
    "leaves a sent swap unsettled while ESPN can't be read back, for recovery to settle",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const answer = await setup.fake.fetch(input, init);
        setup.fake.failReads("espn_unavailable");
        return answer;
      });

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "unsettled" });

      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "executing", lineupState: "sent" });
      expect(await attemptsOf(setup, requestId)).toEqual([
        expect.objectContaining({ status: "answered", outcome: null }),
      ]);
    }
  );

  dbTest(
    "sends nothing for a team taken off the allowlist after the claim, and sends it to review",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);
      const { lease, claimed } = await claimForLineup(setup, requestId);
      await takeTeamOffAllowlist(setup);

      const result = await runLineupStep(
        { ...sendingContextFor(setup), lease, write: setup.fake.write },
        claimed
      );

      expect(result).toEqual({ kind: "sent_to_review", reason: "not_allowlisted" });
      expect(setup.fake.posts).toEqual([]);
      expect(await attemptsOf(setup, requestId)).toEqual([]);
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("pending");
    }
  );

  dbTest(
    "sends nothing when the edit that fits now moves two other starters: it goes to review as stale",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(LILLARD, "OUT");
      const requestId = await insertQueued(setup, lillardForEdey, utilGuardMoves);
      // Sharpe takes the UTIL guard's slot, so no UTIL starter can move to G: Edey fits only once
      // two other starters move.
      await setup.fake.write.applyLineup(
        {
          teamId: TEAM,
          scoringPeriodId: 8,
          moves: [
            { playerId: UTIL_GUARD, fromSlot: "UTIL", toSlot: "BE" },
            { playerId: SHARPE, fromSlot: "BE", toSlot: "UTIL" },
          ],
        },
        { allowlist: new Set([TEAM]), beforeSend: async () => {} }
      );
      const { team } = await setup.fake.read.getLineup(TEAM);
      const fits = planLineupEdit({
        lineup: team,
        injuredPlayerId: LILLARD,
        replacementPlayerId: EDEY,
      });
      expect(fits?.movedStarters).toBe(2);

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({
        kind: "sent_to_review",
        reason: "stale",
      });
      expect(setup.fake.posts).toHaveLength(1);
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("pending");
    }
  );
});

const RULES_MISMATCH = {
  kind: "setting" as const,
  setting: "lineupLocktimeType",
  expected: "INDIVIDUAL_FIRSTGAME_WEEKLY",
  espn: "DAILY",
};

// ESPN as the fake shows it, except that the league's rules differ in one setting.
function espnWithRulesMismatch(setup: Setup): ExecutorContext["espn"] {
  return {
    ...setup.fake.read,
    checkLeagueRules: async () => ({
      ...(await setup.fake.read.checkLeagueRules()),
      mismatches: [RULES_MISMATCH],
    }),
  };
}

describe("the adjustment step", () => {
  dbTest(
    "completes a request that owes nothing without writing an adjustment, saying why",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: 0 });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "completed",
        adjustmentState: "not_owed",
        finalAdjustmentTenths: 0,
      });
      expect(events.at(-1)).toMatchObject({
        eventType: "completed",
        payload: { adjustment: "not_owed", computedTenths: 0 },
      });
    }
  );

  dbTest(
    "adds this request's amount to the side's earlier adjustment and reason, completing once ESPN shows both",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await setSide(setup, "team", 51, "Earlier sub +5.1");
      const requestId = await insertTatumRequest(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      const { request, events } = await detailOf(setup, requestId);
      const entry = adjustmentReasonEntry(request, TATUM_OWED);
      expect(await sideOf(setup, "team")).toMatchObject({
        adjustment: -35.3,
        adjustmentReason: `Earlier sub +5.1 | ${entry}`,
      });
      expect(request).toMatchObject({
        status: "completed",
        adjustmentState: "verified",
        finalAdjustmentTenths: TATUM_OWED,
      });
      expect(events.map((event) => event.eventType).slice(-3)).toEqual([
        "adjustment_sent",
        "adjustment_verified",
        "completed",
      ]);
      const attempts = await attemptsOf(setup, requestId);
      expect(attempts.map(({ kind, outcome }) => ({ kind, outcome }))).toEqual([
        { kind: "lineup", outcome: "verified" },
        { kind: "adjustment", outcome: "verified" },
      ]);
    }
  );

  // Larsson scored 27.0 on the bench on day 7; the request came that day, after 5.7 of them.
  dbTest(
    "credits the replacement's bench points from the request day to the swap, less his points before the request",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        requestDay: 7,
        replacementPointsAtRequestTenths: 57,
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      // Tatum's day 7 back (−40.4), Larsson's day 7 after the request in (27.0 − 5.7).
      expect(result).toMatchObject({ kind: "completed", finalTenths: -191 });
      expect((await sideOf(setup, "team")).adjustment).toBe(-19.1);
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ effectiveDay: 8, finalAdjustmentTenths: -191 });
    }
  );

  dbTest(
    "keeps the lines behind the amount it wrote, with ESPN's readback of the adjustment",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        requestDay: 7,
        replacementPointsAtRequestTenths: 57,
      });

      await runExecutorPass(sendingContextFor(setup));

      const { snapshots } = await detailOf(setup, requestId);
      const verified = snapshots.find(({ phase }) => phase === "adjustment_verified");
      expect(computedLinesOf(verified?.payload)).toEqual([
        { day: 7, playerId: TATUM, tenths: -404, why: "injured_credited_before_swap" },
        { day: 7, playerId: LARSSON, tenths: 213, why: "replacement_after_request" },
      ]);
    }
  );

  dbTest(
    "takes back the replacement's points from before a same-day request",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, { replacementPointsAtRequestTenths: 57 });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED - 57 });
      expect((await sideOf(setup, "team")).adjustment).toBe(-46.1);
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ effectiveDay: 8, finalAdjustmentTenths: TATUM_OWED - 57 });
    }
  );

  dbTest(
    "sends the opponent's side as ESPN shows it just before the write, never as first read",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumRequest(setup);
      // The opponent's adjustment changes while the step checks the rules.
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        checkLeagueRules: async () => {
          await setSide(setup, "opponent", 20, "Opponent's own");
          return setup.fake.read.checkLeagueRules();
        },
      };

      await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(await sideOf(setup, "opponent")).toMatchObject({
        adjustment: 2,
        adjustmentReason: "Opponent's own",
      });
      expect((await sideOf(setup, "team")).adjustment).toBe(-40.4);
    }
  );

  dbTest(
    "holds the adjustment while ESPN's rules differ, keeping the lineup and naming the settings",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      const espn = espnWithRulesMismatch(setup);

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_held_rules" });
      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ lineupState: "verified", adjustmentState: "held" });
      expect(events.at(-1)?.payload).toMatchObject({ mismatches: [RULES_MISMATCH] });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
    }
  );

  dbTest(
    "holds for re-approval an amount unlike the one computed at approval, writing nothing",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, { approvedComputedTenths: -300 });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_changed" });
      const { events } = await detailOf(setup, requestId);
      expect(events.at(-1)?.payload).toMatchObject({
        computedTenths: TATUM_OWED,
        approvedComputedTenths: -300,
      });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
    }
  );

  // X8: a request the commissioner approved runs like any other, its amount still the approved one.
  dbTest(
    "carries out an approved request whose computed amount is still the one approved",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        executionModeAtRequest: "approval_required",
        approvedComputedTenths: TATUM_OWED,
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect((await detailOf(setup, requestId)).request.status).toBe("completed");
      expect((await sideOf(setup, "team")).adjustment).toBe(-40.4);
    }
  );

  dbTest(
    "writes the commissioner's override while the computed amount is the one approved",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumRequest(setup, {
        approvedComputedTenths: TATUM_OWED,
        overrideAdjustmentTenths: 30,
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: 30 });
      expect((await sideOf(setup, "team")).adjustment).toBe(3);
    }
  );

  dbTest(
    "holds an override once the computed amount moved from the approved one, showing both",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        approvedComputedTenths: -300,
        overrideAdjustmentTenths: 30,
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_changed" });
      const { events } = await detailOf(setup, requestId);
      expect(events.at(-1)?.payload).toMatchObject({
        computedTenths: TATUM_OWED,
        approvedComputedTenths: -300,
        overrideTenths: 30,
      });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
    }
  );

  dbTest(
    "sends an adjustment ESPN refused to the commissioner as adjustment_failed, the lineup done",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "refuse");
      const requestId = await insertTatumRequest(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ lineupState: "verified", adjustmentState: "failed" });
      expect((await attemptsOf(setup, requestId)).at(-1)).toMatchObject({
        kind: "adjustment",
        failureCode: "write_refused",
        outcome: "not_applied",
      });
    }
  );

  dbTest(
    "never completes an adjustment ESPN answered 200 to but didn't apply",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "ignore");
      const requestId = await insertTatumRequest(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect((await attemptsOf(setup, requestId)).at(-1)).toMatchObject({
        kind: "adjustment",
        status: "answered",
        outcome: "not_applied",
      });
    }
  );

  dbTest(
    "leaves an adjustment unsettled when ESPN went unreadable after one early read that didn't show it yet",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "ignore");
      const requestId = await insertTatumRequest(setup);

      // The lineup shows on its first read, so the first pause is the adjustment's: its first
      // round reads the side untouched, and every later round can't be read.
      const result = await runExecutorPass({
        ...sendingContextFor(setup),
        sleep: async () => setup.fake.failReads("espn_unavailable"),
      });

      expect(result).toEqual({ kind: "unsettled" });
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "executing",
        lineupState: "verified",
        adjustmentState: "sent",
      });
      expect((await attemptsOf(setup, requestId)).at(-1)).toMatchObject({
        kind: "adjustment",
        status: "answered",
        outcome: null,
      });
      expect(await outbox(setup)).toEqual([]);
    }
  );

  dbTest(
    "holds an adjustment whose reason would pass the cap for the commissioner, writing nothing",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await setSide(setup, "team", 51, "x".repeat(950));
      const requestId = await insertTatumRequest(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      const { request, events } = await detailOf(setup, requestId);
      expect(request.adjustmentState).toBe("held");
      expect(events.at(-1)?.payload).toMatchObject({ detail: "reason_too_long" });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["adjustment", "lineup"]);
    }
  );

  dbTest(
    "writes a held adjustment whose request is past its expiry, its lineup being on ESPN",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumRequest(setup, {
        lineupState: "verified",
        effectiveDay: 8,
        expiresAt: minutesFrom(now, -1),
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["adjustment"]);
    }
  );

  dbTest(
    "sends no adjustment for a team taken off the allowlist after its lineup verified",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      // The team comes off the list while the step checks the rules, after the lineup's readback.
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        checkLeagueRules: async () => {
          await takeTeamOffAllowlist(setup);
          return setup.fake.read.checkLeagueRules();
        },
      };

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "not_allowlisted" });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("verified");
      const attempts = await attemptsOf(setup, requestId);
      expect(attempts.map((attempt) => attempt.kind)).toEqual(["lineup"]);
    }
  );

  dbTest(
    "goes straight to the adjustment for a re-approved held adjustment, leaving the lineup alone",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumRequest(setup, { lineupState: "verified", effectiveDay: 8 });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["adjustment"]);
    }
  );

  dbTest(
    "leaves a sent adjustment unsettled while ESPN can't be read back, for recovery to settle",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const answer = await setup.fake.fetch(input, init);
        if (String(input).endsWith("/schedule")) setup.fake.failReads("espn_unavailable");
        return answer;
      });

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "unsettled" });

      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "executing", adjustmentState: "sent" });
      expect((await attemptsOf(setup, requestId)).at(-1)).toMatchObject({
        kind: "adjustment",
        outcome: null,
      });
    }
  );
});

// An earlier request this week that put Tatum in as the replacement: Tatum's credit from it is
// forfeited if he is the starter of a later request (A20), which the app can't work out yet.
async function insertTatumCameIn(setup: Setup, fields: Partial<NewSubRequest>) {
  return insertQueued(setup, {
    injuredPlayerId: 9_999_001,
    injuredName: "Invented Starter",
    replacementPlayerId: TATUM,
    replacementName: "Jayson Tatum",
    createdAt: minutesFrom(now, -180),
    ...fields,
  });
}

async function reviewPayloadOf(setup: Setup, requestId: string) {
  const { events } = await detailOf(setup, requestId);
  return events.findLast((event) => event.eventType === "sent_to_review")?.payload;
}

describe("a chained credit (A20)", () => {
  dbTest(
    "writes the lineup of an approved request whose starter came in through an earlier request, then holds its adjustment",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const earlierId = await insertTatumCameIn(setup, {
        status: "completed",
        lineupState: "verified",
      });
      const requestId = await insertTatumRequest(setup, {
        executionModeAtRequest: "approval_required",
        approvedComputedTenths: TATUM_OWED,
      });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        lineupState: "verified",
        adjustmentState: "held",
      });
      expect(await reviewPayloadOf(setup, requestId)).toMatchObject({
        detail: "chained_credit",
        earlierRequestId: earlierId,
      });
    }
  );

  dbTest(
    "holds it too while the earlier request's lineup is on ESPN and its adjustment isn't settled",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumCameIn(setup, {
        status: "needs_review",
        reviewReason: "adjustment_failed",
        lineupState: "verified",
        adjustmentState: "held",
      });
      await insertTatumRequest(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup"]);
    }
  );

  dbTest(
    "writes the adjustment as usual when the earlier request was reversed",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumCameIn(setup, { status: "reversed", lineupState: "verified" });
      await insertTatumRequest(setup);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup", "adjustment"]);
    }
  );
});

describe("recovery", () => {
  dbTest(
    "finds a lineup edit ESPN applied before its answer was recorded, and goes on to the adjustment",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      const { edit } = await claimedAndStopped(setup, requestId);
      await sendThenStop(setup, { requestId, kind: "lineup" }, (write, guard) =>
        write.applyLineup({ teamId: TEAM, scoringPeriodId: 8, moves: edit.items }, guard)
      );

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup", "adjustment"]);
      expect((await detailOf(setup, requestId)).request.effectiveDay).toBe(8);
    }
  );

  dbTest(
    "completes an adjustment ESPN applied before its answer was recorded, sending nothing again",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        status: "executing",
        lineupState: "verified",
        effectiveDay: 8,
      });
      const { request } = await detailOf(setup, requestId);
      const reason = adjustmentReasonEntry(request, TATUM_OWED);
      const matchup = await recordedMatchup(setup);
      await sendThenStop(setup, { requestId, kind: "adjustment" }, (write, guard) =>
        write.applyAdjustment({ matchup, teamId: TEAM, targetTenths: TATUM_OWED, reason }, guard)
      );

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["adjustment"]);
      expect((await sideOf(setup, "team")).adjustment).toBe(-40.4);
    }
  );

  dbTest(
    "sends a lineup ESPN shows only in part after an interrupted write to the commissioner as ambiguous",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.skipLineupItems([1]);
      const requestId = await insertTatumRequest(setup);
      const { edit } = await claimedAndStopped(setup, requestId);
      await sendThenStop(setup, { requestId, kind: "lineup" }, (write, guard) =>
        write.applyLineup({ teamId: TEAM, scoringPeriodId: 8, moves: edit.items }, guard)
      );

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect(setup.fake.posts).toHaveLength(1);
    }
  );

  dbTest(
    "puts a request claimed with nothing sent back in line for a fresh preflight",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      await claimedAndStopped(setup, requestId);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "requeued" });
      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "queued", lineupState: "pending" });
      expect(events.at(-1)?.eventType).toBe("requeued");
      expect(setup.fake.posts).toEqual([]);
    }
  );

  dbTest(
    "leaves an interrupted request alone while another worker holds the lease",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      await claimedAndStopped(setup, requestId);
      await acquireWriteLease(database.connection.db, { holder: "another-worker", ttlSeconds: 60 });

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "lease_held" });
      expect((await detailOf(setup, requestId)).request.status).toBe("executing");
    }
  );

  dbTest(
    "keeps a write ESPN declined while down in progress, then runs it again once ESPN answers",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      setup.fake.answerWrites("lineup", "unavailable");
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const answer = await setup.fake.fetch(input, init);
        setup.fake.failReads("espn_unavailable");
        return answer;
      });

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "unsettled" });
      expect((await getEspnAccess(database.connection.db))?.state).toBe("unreachable");

      vi.stubGlobal("fetch", setup.fake.fetch);
      setup.fake.failReads(null);
      setup.fake.answerWrites("lineup", "apply");
      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
      expect(await runExecutorPass(sendingContextFor(setup))).toMatchObject({ kind: "completed" });

      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup", "lineup", "adjustment"]);
      expect((await detailOf(setup, requestId)).request.status).toBe("completed");
    }
  );

  dbTest(
    "puts an adjustment ESPN declined as unavailable back in line, to run the adjustment again",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "unavailable");
      const requestId = await insertTatumRequest(setup);

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "queued",
        lineupState: "verified",
      });
    }
  );

  dbTest(
    "leaves a write its five sends after bodies only recorded while sending was off",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      const { request } = await detailOf(setup, requestId);
      const lease = await acquireWriteLease(setup.connection.db, {
        holder: "rehearsing",
        ttlSeconds: 60,
      });
      const { write } = rehearsingContextFor(setup);
      if (lease === null || write === null)
        throw new Error("expected the lease and a write client");
      const context = { ...contextFor(setup), lease, write };
      const attempt = { requestId, teamId: TEAM, matchupId: setup.matchupId, scoringPeriodId: 8 };
      for (let body = 0; body < 5; body += 1) {
        const sent = await sendWrite(
          context,
          { ...attempt, kind: "lineup" },
          new Set([TEAM]),
          (client, guard) =>
            client.applyLineup({ teamId: TEAM, scoringPeriodId: 8, moves: utilGuardMoves }, guard)
        );
        if (sent.kind !== "recorded_only") throw new Error("expected a body recorded, not sent");
        await recordNotSent(context, sent.writeId);
      }

      expect(await sendsLeft(context, request, "lineup")).toBe(true);
    }
  );

  dbTest(
    "sends a swap ESPN declined five times to the commissioner as lineup_failed, never a sixth time",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      setup.fake.answerWrites("lineup", "unavailable");
      const requestId = await insertQueued(setup);

      const passes: string[] = [];
      for (let pass = 0; pass < 6; pass += 1) {
        passes.push((await runExecutorPass(sendingContextFor(setup))).kind);
      }

      const requeued = ["requeued", "requeued", "requeued", "requeued"];
      expect(passes).toEqual([...requeued, "sent_to_review", "idle"]);
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(Array(5).fill("lineup"));
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "needs_review",
        reviewReason: "lineup_failed",
        lineupState: "failed",
      });
      expect(await outbox(setup)).toHaveLength(1);
    }
  );

  dbTest(
    "sends an adjustment ESPN declined five times to the commissioner as adjustment_failed, the lineup done",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "unavailable");
      const requestId = await insertTatumRequest(setup);

      const passes: string[] = [];
      for (let pass = 0; pass < 6; pass += 1) {
        passes.push((await runExecutorPass(sendingContextFor(setup))).kind);
      }

      const requeued = ["requeued", "requeued", "requeued", "requeued"];
      expect(passes).toEqual([...requeued, "sent_to_review", "idle"]);
      const adjustments = setup.fake.posts.filter((post) => post.kind === "adjustment");
      expect(adjustments).toHaveLength(5);
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "needs_review",
        reviewReason: "adjustment_failed",
        lineupState: "verified",
        adjustmentState: "failed",
      });
      expect(await outbox(setup)).toHaveLength(1);
    }
  );

  dbTest(
    "sends no sixth adjustment when the fifth was cut off before its answer and ESPN shows nothing",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "unavailable");
      const requestId = await insertTatumRequest(setup);
      for (let pass = 0; pass < 4; pass += 1) await runExecutorPass(sendingContextFor(setup));
      const { request } = await detailOf(setup, requestId);
      const reason = adjustmentReasonEntry(request, TATUM_OWED);
      const matchup = await recordedMatchup(setup);
      await sendThenStop(setup, { requestId, kind: "adjustment" }, (write, guard) =>
        write.applyAdjustment({ matchup, teamId: TEAM, targetTenths: TATUM_OWED, reason }, guard)
      );
      const posted = setup.fake.posts.length;

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(setup.fake.posts).toHaveLength(posted);
      expect((await sideOf(setup, "team")).adjustment).toBe(0);
    }
  );

  dbTest(
    "completes a re-run adjustment ESPN applied after its readback, adding nothing a second time",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "unavailable");
      const requestId = await insertTatumRequest(setup);
      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
      // The declined write lands after all: the side at its target, with the request's entry.
      setup.fake.answerWrites("adjustment", "apply");
      const { request } = await detailOf(setup, requestId);
      await setSide(setup, "team", TATUM_OWED, adjustmentReasonEntry(request, TATUM_OWED));
      const posted = setup.fake.posts.length;

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect((await sideOf(setup, "team")).adjustment).toBe(-40.4);
      expect(setup.fake.posts).toHaveLength(posted);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "completed",
        finalAdjustmentTenths: TATUM_OWED,
      });
    }
  );

  dbTest(
    "sends a re-run adjustment to the commissioner when the side is at its target under another reason",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "unavailable");
      const requestId = await insertTatumRequest(setup);
      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
      // The declined write landed after all, and ESPN shows its reason in another form.
      setup.fake.answerWrites("adjustment", "apply");
      await setSide(setup, "team", TATUM_OWED, "Injury sub, as ESPN shows it");
      const posted = setup.fake.posts.length;

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect(setup.fake.posts).toHaveLength(posted);
      expect((await sideOf(setup, "team")).adjustment).toBe(-40.4);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "needs_review",
        adjustmentState: "failed",
      });
    }
  );

  dbTest(
    "sends a re-run adjustment to the commissioner when the side names it at another value",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("adjustment", "unavailable");
      const requestId = await insertTatumRequest(setup);
      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
      // It landed, and the side's value was changed since.
      setup.fake.answerWrites("adjustment", "apply");
      const { request } = await detailOf(setup, requestId);
      await setSide(setup, "team", TATUM_OWED + 100, adjustmentReasonEntry(request, TATUM_OWED));
      const posted = setup.fake.posts.length;

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect((await sideOf(setup, "team")).adjustment).toBe(-30.4);
      expect(setup.fake.posts).toHaveLength(posted);
    }
  );

  dbTest(
    "never adds to a side whose reason already names the request, entered by hand at another amount",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        lineupState: "verified",
        effectiveDay: 8,
      });
      const { request } = await detailOf(setup, requestId);
      await setSide(setup, "team", -300, adjustmentReasonEntry(request, -300));
      const posted = setup.fake.posts.length;

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect((await sideOf(setup, "team")).adjustment).toBe(-30);
      expect(setup.fake.posts).toHaveLength(posted);
      expect((await detailOf(setup, requestId)).events.at(-1)?.payload).toMatchObject({
        detail: "adjustment_unclear",
      });
    }
  );

  dbTest(
    "puts a write ESPN declined as unavailable back in line when ESPN shows it untouched",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.answerWrites("lineup", "unavailable");
      const requestId = await insertTatumRequest(setup);

      expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "queued",
        lineupState: "pending",
      });
    }
  );
});

// The team's week with Larsson scoring 12.4 on the bench on `day`.
function benchPointsOn(read: TeamWeekRead, day: number): TeamWeekRead {
  const stats = { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 };
  const line = { fantasyPoints: 12.4, ...stats };
  return {
    ...read,
    days: read.days.map((each) =>
      each.scoringPeriodId !== day
        ? each
        : {
            ...each,
            players: each.players.map((player) =>
              player.playerId === LARSSON ? { ...player, active: false, line } : player
            ),
          }
    ),
  };
}

describe("a rehearsal, with sending switched off", () => {
  dbTest(
    "completes with both writes recorded and none sent, the lineup never shown as on ESPN",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);

      const result = await runExecutorPass(rehearsingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts).toEqual([]);
      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "completed",
        isRehearsal: true,
        lineupState: "pending",
        effectiveDay: null,
        adjustmentState: "pending",
        finalAdjustmentTenths: TATUM_OWED,
      });
      const [lineup, adjustment] = await attemptsOf(setup, requestId);
      expect(lineup).toMatchObject({ kind: "lineup", status: "recorded_only", outcome: null });
      expect(lineup?.body).toMatchObject({
        teamId: TEAM,
        scoringPeriodId: 8,
        items: [{ playerId: TATUM }, { playerId: LARSSON }],
      });
      expect(adjustment).toMatchObject({
        kind: "adjustment",
        status: "recorded_only",
        outcome: null,
      });
      const [sides] = adjustment?.body as [Record<string, unknown>];
      expect(Object.values(sides)).toContainEqual({
        teamId: TEAM,
        adjustment: -40.4,
        adjustmentReason: adjustmentReasonEntry(request, TATUM_OWED),
      });
      expect(events.map((event) => event.eventType)).toEqual([
        "request_filed",
        "claimed",
        "completed",
      ]);
      expect(events.at(-1)?.payload).toMatchObject({
        rehearsal: true,
        assumedEffectiveDay: 8,
        lineupWriteId: lineup?.writeId,
        adjustmentWriteId: adjustment?.writeId,
        lines: [{ playerId: TATUM, day: 7, tenths: TATUM_OWED }],
      });
    }
  );

  // Larsson scores on the bench on day 8, after the request. Had the edit applied from day 8, as
  // its body said, ESPN's lineup would credit those points, so the adjustment leaves them out.
  dbTest(
    "works out a rehearsal's amount as if the edit had applied from the day its body named",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertTatumRequest(setup);
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        getTeamWeek: async (teamId) => benchPointsOn(await setup.fake.read.getTeamWeek(teamId), 8),
      };

      const result = await runExecutorPass({ ...rehearsingContextFor(setup), espn });

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
    }
  );

  dbTest(
    "completes a rehearsal that owes nothing with only the lineup recorded",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      setup.fake.setDesignation(TOWNS, "OUT");
      const requestId = await insertQueued(setup);

      const result = await runExecutorPass(rehearsingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: 0 });
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "completed",
        isRehearsal: true,
        lineupState: "pending",
        adjustmentState: "not_owed",
      });
      const attempts = await attemptsOf(setup, requestId);
      expect(attempts.map(({ kind, status }) => ({ kind, status }))).toEqual([
        { kind: "lineup", status: "recorded_only" },
      ]);
    }
  );

  dbTest(
    "holds a rehearsal's adjustment while ESPN's rules differ, its lineup still to do",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup);
      const espn = espnWithRulesMismatch(setup);

      const result = await runExecutorPass({ ...rehearsingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_held_rules" });
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "needs_review",
        isRehearsal: true,
        lineupState: "pending",
        effectiveDay: null,
        adjustmentState: "held",
      });
      expect(setup.fake.posts).toEqual([]);
    }
  );

  dbTest(
    "never completes a request whose lineup is on ESPN while its adjustment isn't sent",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, {
        lineupState: "verified",
        effectiveDay: 8,
      });

      const result = await runExecutorPass(rehearsingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "needs_review",
        isRehearsal: false,
        lineupState: "verified",
        adjustmentState: "held",
      });
      expect(events.at(-1)?.payload).toMatchObject({ detail: "not_sent" });
      const attempts = await attemptsOf(setup, requestId);
      expect(attempts.map(({ kind, status }) => ({ kind, status }))).toEqual([
        { kind: "adjustment", status: "recorded_only" },
      ]);
      expect(setup.fake.posts).toEqual([]);
    }
  );

  dbTest(
    "sends the lineup first when a rehearsed request runs again with sending on, and drops the mark",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, { isRehearsal: true });

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect(setup.fake.posts.map((post) => post.kind)).toEqual(["lineup", "adjustment"]);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        isRehearsal: false,
        lineupState: "verified",
        effectiveDay: 8,
      });
    }
  );

  dbTest(
    "drops the mark from a rehearsed request whose live lineup write recovery verifies",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertTatumRequest(setup, { isRehearsal: true });
      const { edit } = await claimedAndStopped(setup, requestId);
      await sendThenStop(setup, { requestId, kind: "lineup" }, (write, guard) =>
        write.applyLineup({ teamId: TEAM, scoringPeriodId: 8, moves: edit.items }, guard)
      );

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        isRehearsal: false,
        lineupState: "verified",
      });
    }
  );
});

// Team 1's matchup in period 1, as recorded: at home against team 11. The fake's ESPN is in
// period 2, so that matchup has ended.
const PAST_MATCHUP = 5;

// A request of that ended matchup whose lineup ESPN showed from day 4, in line for its adjustment.
async function insertPastRequest(setup: Setup, overrides: Partial<NewSubRequest> = {}) {
  return insertTatumRequest(setup, {
    matchupPeriodId: 1,
    matchupId: PAST_MATCHUP,
    requestDay: 3,
    lineupState: "verified",
    effectiveDay: 4,
    ...overrides,
  });
}

// The commissioner's approval as the web records it.
async function recordApproval(
  setup: Setup,
  requestId: string,
  eventType: "approved" | "reapproved",
  payload: { computedTenths: number; lineupState: string; effectiveDay: number | null }
) {
  await appendEvent(setup.connection.db, requestId, {
    eventId: randomUUID(),
    actorType: "commissioner",
    actorUserId: setup.commissioner,
    eventType,
    payload,
    createdAt: minutesFrom(now, -5),
  });
}

describe("a held adjustment re-approved after its matchup ended", () => {
  dbTest(
    "writes the approved amount to that matchup's side, the sweep having left it in line",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const { matchup: before } = await setup.fake.read.getMatchup(PAST_MATCHUP);
      await setup.fake.write.applyAdjustment(
        { matchup: before, teamId: 11, targetTenths: 20, reason: "Opponent's own" },
        { allowlist: new Set([11]), beforeSend: async () => {} }
      );
      const requestId = await insertPastRequest(setup, { approvedComputedTenths: TATUM_OWED });
      await recordApproval(setup, requestId, "reapproved", {
        computedTenths: TATUM_OWED,
        lineupState: "verified",
        effectiveDay: 4,
      });
      const context = sendingContextFor(setup);
      await sweepWaitingRequests({ ...context, espn: setup.fake.read });

      const result = await runExecutorPass(context);

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      const { request, snapshots } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ status: "completed", adjustmentState: "verified" });
      // Nothing was recomputed after the week, so the readback's snapshot keeps no lines.
      const verified = snapshots.find(({ phase }) => phase === "adjustment_verified");
      expect(verified).toBeDefined();
      expect(computedLinesOf(verified?.payload)).toBeNull();
      const { matchup } = await setup.fake.read.getMatchup(PAST_MATCHUP);
      expect(matchup.home).toEqual({
        teamId: TEAM,
        adjustment: -40.4,
        adjustmentReason: adjustmentReasonEntry(request, TATUM_OWED),
      });
      expect(matchup.away).toEqual({
        teamId: 11,
        adjustment: 2,
        adjustmentReason: "Opponent's own",
      });
      // Never the current week's matchup.
      expect((await sideOf(setup, "team")).adjustment).toBe(0);
    }
  );

  // Only a re-approval recorded after this lineup's readback approved an amount computed from
  // complete days. A first approval's amount is a projection, and nothing can be recomputed now.
  dbTest.for([
    {
      name: "a first approval, made before the lineup was written",
      approval: {
        eventType: "approved",
        payload: { computedTenths: -300, lineupState: "pending", effectiveDay: null },
      },
    },
    {
      name: "a re-approval recorded for another effective day",
      approval: {
        eventType: "reapproved",
        payload: { computedTenths: -300, lineupState: "verified", effectiveDay: 3 },
      },
    },
    {
      name: "a first approval, even one recorded with the lineup verified",
      approval: {
        eventType: "approved",
        payload: { computedTenths: -300, lineupState: "verified", effectiveDay: 4 },
      },
    },
    { name: "no approval at all", approval: null },
  ] as const)(
    "keeps the adjustment for the commissioner after $name",
    async ({ approval }, { database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertPastRequest(setup, {
        approvedComputedTenths: approval === null ? null : -300,
      });
      if (approval !== null) {
        await recordApproval(setup, requestId, approval.eventType, approval.payload);
      }

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      const { request, events } = await detailOf(setup, requestId);
      expect(request).toMatchObject({ lineupState: "verified", adjustmentState: "held" });
      expect(events.at(-1)?.payload).toMatchObject({ detail: "week_moved_on" });
      expect(setup.fake.posts).toEqual([]);
    }
  );
});

// A pass that throws leaves its request where it stood, and the next pass meets that request
// first: a failure that repeats would hold up every request behind it (X20).
describe("a pass that keeps failing on one request", () => {
  const failing = (setup: Setup, read: "checkLeagueRules" | "getTeamWeek"): ExecutorContext => ({
    ...sendingContextFor(setup),
    espn: {
      ...setup.fake.read,
      [read]: async () => {
        throw new RangeError("invented details, never recorded");
      },
    },
  });
  const failedPassesOf = async (setup: Setup, requestId: string) =>
    (await detailOf(setup, requestId)).events.filter(
      ({ eventType }) => eventType === "pass_failed"
    );

  dbTest(
    "goes to the commissioner after five failed passes, and the next request runs",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const stuck = await insertTatumRequest(setup);
      setup.fake.setDesignation(TOWNS, "OUT");
      const next = await insertQueued(setup, { createdAt: minutesFrom(now, -30) });

      // The lineup verifies, then the adjustment step throws on every pass.
      for (let pass = 0; pass < 5; pass += 1) {
        await expect(runExecutorPass(failing(setup, "checkLeagueRules"))).rejects.toThrow(
          RangeError
        );
      }

      const { request, events } = await detailOf(setup, stuck);
      expect(request).toMatchObject({
        status: "needs_review",
        reviewReason: "ambiguous",
        lineupState: "verified",
      });
      // Each pass's clock starts over, so the review is found by its type, not as the last event.
      const review = events.findLast(({ eventType }) => eventType === "sent_to_review");
      expect(review?.payload).toMatchObject({
        detail: "pass_failed",
        error: "RangeError",
        failures: 5,
      });
      expect(await failedPassesOf(setup, stuck)).toHaveLength(4);
      expect(await outbox(setup)).toHaveLength(1);

      await expect(runExecutorPass(failing(setup, "checkLeagueRules"))).rejects.toThrow(RangeError);
      expect((await detailOf(setup, next)).request.status).toBe("executing");
    }
  );

  dbTest("counts a pass that fails before the claim, with nothing sent", async ({ database }) => {
    const setup = await setUp(database.connection);
    const requestId = await insertTatumRequest(setup);

    for (let pass = 0; pass < 4; pass += 1) {
      await expect(runExecutorPass(failing(setup, "getTeamWeek"))).rejects.toThrow(RangeError);
    }
    expect((await detailOf(setup, requestId)).request.status).toBe("queued");
    await expect(runExecutorPass(failing(setup, "getTeamWeek"))).rejects.toThrow(RangeError);

    const { request } = await detailOf(setup, requestId);
    expect(request).toMatchObject({
      status: "needs_review",
      reviewReason: "ambiguous",
      lineupState: "pending",
    });
    expect(setup.fake.posts).toEqual([]);
  });

  dbTest("records a failed pass by the error's name, never its message", async ({ database }) => {
    const setup = await setUp(database.connection);
    const requestId = await insertTatumRequest(setup);

    await expect(runExecutorPass(failing(setup, "getTeamWeek"))).rejects.toThrow(RangeError);

    const [failed] = await failedPassesOf(setup, requestId);
    expect(failed?.payload).toEqual({ error: "RangeError" });
  });
});
