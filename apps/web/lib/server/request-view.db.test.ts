import { randomUUID } from "node:crypto";
import {
  appendEvent,
  insertSnapshot,
  recordEspnAccess,
  recordWorkerHeartbeat,
} from "@injurysub/db";
import {
  type AdjustmentLine,
  claimedEditRecord,
  computedRecord,
  type LineupMove,
  planRecord,
} from "@injurysub/domain";
import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadRequestDetail } from "./commish";
import { actOnRequest } from "./commish-actions";
import { loadRequestView, loadTeamHistory } from "./request-view";
import {
  insertInventedRequest,
  insertInventedUser,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "./test-support";

const filedAt = (minute: number) =>
  new Date(`2026-10-28T01:${String(minute).padStart(2, "0")}:00Z`);

describe("loadTeamHistory", () => {
  webDbTest("lists only the team's own requests, newest first", async ({ database }) => {
    const { db } = database.connection;
    const older = await insertInventedRequest(db, { status: "rejected", createdAt: filedAt(1) });
    const newer = await insertInventedRequest(db, {
      injuredPlayerId: 4065648,
      injuredName: "Jayson Tatum",
      createdAt: filedAt(5),
    });
    await insertInventedRequest(db, { teamId: 2, injuredPlayerId: 1, createdAt: filedAt(9) });

    const history = await loadTeamHistory({ teamId: 1 });

    expect(history.status === "found" && history.requests.map((each) => each.requestId)).toEqual([
      newer,
      older,
    ]);
  });
});

// Lillard (6606) credited with 20.5 on day 7.
const lillardOnDay7: TeamWeekChange = (read) => ({
  ...read,
  days: read.days.map((day) =>
    day.scoringPeriodId !== 7
      ? day
      : {
          ...day,
          players: day.players.map((player) =>
            player.playerId !== 6606
              ? player
              : {
                  ...player,
                  active: true,
                  line: {
                    fantasyPoints: 20.5,
                    points: 0,
                    rebounds: 0,
                    assists: 0,
                    steals: 0,
                    blocks: 0,
                    turnovers: 0,
                  },
                }
          ),
        }
  ),
});

const sumOf = (lines: { tenths: number }[]) => lines.reduce((sum, line) => sum + line.tenths, 0);

describe("a request completed by hand", () => {
  // A1: the lines shown are the ones computed for its effective day, and add up to its amount.
  webDbTest(
    "shows the lines computed for its effective day, to the manager and the commissioner",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(
        createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }),
        lillardOnDay7
      );
      const requestId = await insertInventedRequest(
        db,
        { requestDay: 7, projectedAdjustmentTenths: 0 },
        { projection: { totalTenths: 0, lines: [] } }
      );
      const form = new FormData();
      form.set("version", "0");
      form.set("effectiveDay", "8");
      const actorUserId = await insertInventedUser(db, { role: "commissioner", teamId: null });
      const completed = await actOnRequest({
        actorUserId,
        actorTeamId: null,
        requestId,
        action: "complete",
        form,
        now: new Date(),
      });

      const view = await loadRequestView({ teamId: 1, requestId });
      const detail = await loadRequestDetail({ requestId });

      expect(completed.status).toBe("completed_manually");
      if (view.status !== "found" || detail.status !== "found") throw new Error("not found");
      expect(view.request.adjustmentTenths).toBe(-205);
      expect(sumOf(view.breakdown)).toBe(-205);
      expect(sumOf(detail.breakdown)).toBe(-205);
    }
  );
});

describe("a request the worker completed", () => {
  // A1: the lines shown are the ones the worker computed once ESPN showed the swap, not Confirm's.
  webDbTest(
    "shows the lines behind the amount the worker wrote, to the manager and the commissioner",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const requestId = await insertInventedRequest(
        db,
        {
          status: "completed",
          reviewReason: null,
          requestDay: 7,
          lineupState: "verified",
          effectiveDay: 8,
          adjustmentState: "verified",
          finalAdjustmentTenths: -191,
        },
        { projection: { totalTenths: 0, lines: [] } }
      );
      const lines: AdjustmentLine[] = [
        { day: 7, playerId: 6606, tenths: -404, why: "injured_credited_before_swap" },
        { day: 7, playerId: 5144091, tenths: 213, why: "replacement_after_request" },
      ];
      await insertSnapshot(db, requestId, "adjustment_verified", {
        snapshotId: randomUUID(),
        espnDay: 8,
        takenAt: filedAt(30),
        payload: { matchup: { matchupId: 7 }, ...computedRecord(lines) },
      });

      const view = await loadRequestView({ teamId: 1, requestId });
      const detail = await loadRequestDetail({ requestId });

      if (view.status !== "found" || detail.status !== "found") throw new Error("not found");
      const shown = [
        { day: 7, name: "Damian Lillard", tenths: -404, why: "injured_credited_before_swap" },
        { day: 7, name: "Jeremiah Fears", tenths: 213, why: "replacement_after_request" },
      ];
      expect(view.request.adjustmentTenths).toBe(-191);
      expect(view.breakdown).toEqual(shown);
      expect(detail.breakdown).toEqual(shown);
    }
  );
});

describe("loadRequestView", () => {
  webDbTest("shows the team's request with its adjustment, day by day", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(
      db,
      { projectedAdjustmentTenths: -329 },
      {
        projection: {
          totalTenths: -329,
          lines: [
            { day: 7, playerId: 6606, tenths: -205, why: "injured_credited_before_swap" },
            { day: 8, playerId: 5144091, tenths: -124, why: "replacement_before_request" },
          ],
        },
      }
    );

    const view = await loadRequestView({ teamId: 1, requestId });

    expect(view).toMatchObject({
      status: "found",
      request: {
        requestId,
        status: "needs_review",
        injuredName: "Damian Lillard",
        replacementName: "Jeremiah Fears",
        adjustmentTenths: -329,
        adjustmentIsFinal: false,
        effectiveDay: null,
      },
      breakdown: [
        { day: 7, name: "Damian Lillard", tenths: -205, why: "injured_credited_before_swap" },
        { day: 8, name: "Jeremiah Fears", tenths: -124, why: "replacement_before_request" },
      ],
      canWithdraw: true,
      refreshing: false,
    });
  });

  // S20: a proving request shows only on the proving page, so the team's page is told to send
  // its reader there, never given it as a substitution.
  webDbTest(
    "answers a proving request as proving, never as the team's request",
    async ({ database }) => {
      const { db } = database.connection;
      const requestId = await insertInventedRequest(db, { kind: "proving" });

      expect(await loadRequestView({ teamId: 1, requestId })).toEqual({ status: "proving" });
    }
  );

  webDbTest("refreshes itself while a request is in line or in progress", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(db, { status: "queued", reviewReason: null });

    expect(await loadRequestView({ teamId: 1, requestId })).toMatchObject({ refreshing: true });
  });

  webDbTest(
    "shows a request in line as delayed while ESPN can't be read, and only then",
    async ({ database }) => {
      const { db } = database.connection;
      const queued = await insertInventedRequest(db, { status: "queued", reviewReason: null });
      const approval = await insertInventedRequest(db, {
        status: "awaiting_approval",
        reviewReason: null,
        injuredPlayerId: 3,
      });
      const checkedAt = new Date("2026-11-13T18:00:00.000Z");

      await recordEspnAccess(db, { state: "working", code: null, checkedAt });
      expect(await loadRequestView({ teamId: 1, requestId: queued })).toMatchObject({
        delayed: false,
      });
      await recordEspnAccess(db, { state: "unreachable", code: "espn_unavailable", checkedAt });
      expect(await loadRequestView({ teamId: 1, requestId: queued })).toMatchObject({
        delayed: true,
      });
      expect(await loadRequestView({ teamId: 1, requestId: approval })).toMatchObject({
        delayed: false,
      });
    }
  );

  // Dec-D31c, O13: nothing has been sent while the worker is down, so it never reads in progress.
  webDbTest(
    "shows a request in line as not started while the worker's beat is stale, and again once a beat lands",
    async ({ database }) => {
      const { db } = database.connection;
      const queued = await insertInventedRequest(db, { status: "queued", reviewReason: null });
      const approval = await insertInventedRequest(db, {
        status: "awaiting_approval",
        reviewReason: null,
        injuredPlayerId: 3,
      });
      const startedAt = new Date(Date.now() - 600_000);

      await recordWorkerHeartbeat(db, {
        workerId: "worker-a",
        startedAt,
        beatAt: new Date(Date.now() - 181_000),
      });
      expect(await loadRequestView({ teamId: 1, requestId: queued })).toMatchObject({
        notStarted: true,
      });
      expect(await loadRequestView({ teamId: 1, requestId: approval })).toMatchObject({
        notStarted: false,
      });
      await recordWorkerHeartbeat(db, { workerId: "worker-a", startedAt, beatAt: new Date() });
      expect(await loadRequestView({ teamId: 1, requestId: queued })).toMatchObject({
        notStarted: false,
      });
    }
  );

  // A request back in line at its adjustment has its swap on ESPN: only the adjustment waits.
  webDbTest(
    "says only the adjustment waits, never not started, while the worker is down after the swap is on ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      const requestId = await insertInventedRequest(db, {
        status: "queued",
        reviewReason: null,
        lineupState: "verified",
        effectiveDay: 8,
      });
      const startedAt = new Date(Date.now() - 600_000);

      await recordWorkerHeartbeat(db, {
        workerId: "worker-a",
        startedAt,
        beatAt: new Date(Date.now() - 181_000),
      });
      expect(await loadRequestView({ teamId: 1, requestId })).toMatchObject({
        notStarted: false,
        adjustmentNotSent: true,
      });
      await recordWorkerHeartbeat(db, { workerId: "worker-a", startedAt, beatAt: new Date() });
      expect(await loadRequestView({ teamId: 1, requestId })).toMatchObject({
        notStarted: false,
        adjustmentNotSent: false,
      });
    }
  );

  webDbTest("offers no withdraw or undo on a processed substitution", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(db, {
      status: "completed",
      reviewReason: null,
      lineupState: "verified",
    });

    expect(await loadRequestView({ teamId: 1, requestId })).toMatchObject({ canWithdraw: false });
  });

  webDbTest("gives the commissioner's reason for a rejection", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(db, { status: "rejected", reviewReason: null });
    await appendEvent(db, requestId, {
      eventId: randomUUID(),
      actorType: "commissioner",
      actorUserId: null,
      eventType: "rejected",
      payload: { reason: "He was active that night." },
      createdAt: filedAt(30),
    });

    expect(await loadRequestView({ teamId: 1, requestId })).toMatchObject({
      commissionerReason: "He was active that night.",
    });
  });

  webDbTest(
    "shows the edit sent once claimed, saying when it differs from the one confirmed",
    async ({ database }) => {
      const { db } = database.connection;
      const read = await createEspnReadClient({
        mode: "scripted",
        scenario: "one-out-starter",
      }).getTeamWeek(1);
      const utilGuard = read.lineup.starters.find(({ player }) => player?.playerId === 4900671);
      // Confirmed with the UTIL forward moving to G; sent with the UTIL guard moving instead.
      const confirmed: LineupMove[] = [
        { playerId: 6606, fromSlot: "G", toSlot: "BE" },
        { playerId: 4278562, fromSlot: "UTIL", toSlot: "G" },
        { playerId: 4600663, fromSlot: "BE", toSlot: "UTIL" },
      ];
      const sent: LineupMove[] = [
        confirmed[0]!,
        { ...confirmed[1]!, playerId: 4900671 },
        confirmed[2]!,
      ];
      const requestId = await insertInventedRequest(
        db,
        {
          status: "executing",
          reviewReason: null,
          replacementPlayerId: 4600663,
          replacementName: "Zach Edey",
        },
        { lineup: read.lineup, ...planRecord({ items: confirmed, movedStarters: 1 }) }
      );
      const before = await loadRequestView({ teamId: 1, requestId });
      await appendEvent(db, requestId, {
        eventId: randomUUID(),
        actorType: "system",
        actorUserId: null,
        eventType: "claimed",
        payload: {
          resumeAt: "lineup",
          espnDay: 8,
          ...claimedEditRecord({ items: sent, movedStarters: 1 }, confirmed),
        },
        createdAt: filedAt(30),
      });

      const after = await loadRequestView({ teamId: 1, requestId });

      expect(before).toMatchObject({ status: "found", sentEdit: null });
      expect(after).toMatchObject({
        status: "found",
        sentEdit: {
          items: [
            { name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
            { name: utilGuard?.player?.name, fromSlot: "UTIL", toSlot: "G" },
            { name: "Zach Edey", fromSlot: "BE", toSlot: "UTIL" },
          ],
          differsFromConfirmed: true,
        },
      });
    }
  );

  // S11: a request reads as a rehearsal from its own run's record, whatever the worker's send
  // mode is by the time its page is opened.
  webDbTest.for([
    { isRehearsal: true, sendModeNow: "live" },
    { isRehearsal: false, sendModeNow: "never" },
  ] as const)(
    "reads rehearsal $isRehearsal from the request while the worker reports $sendModeNow",
    async ({ isRehearsal, sendModeNow }, { database }) => {
      const { db } = database.connection;
      setWebEspn(
        createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }),
        undefined,
        sendModeNow
      );
      const requestId = await insertInventedRequest(db, {
        status: "completed",
        reviewReason: null,
        isRehearsal,
        finalAdjustmentTenths: -404,
      });

      const view = await loadRequestView({ teamId: 1, requestId });

      expect(view.status === "found" && view.request.rehearsal).toBe(isRehearsal);
    }
  );

  webDbTest("doesn't show another team's request", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(db, { teamId: 2 });

    expect(await loadRequestView({ teamId: 1, requestId })).toEqual({ status: "not_found" });
    expect(await loadRequestView({ teamId: 1, requestId: "not-a-uuid" })).toEqual({
      status: "not_found",
    });
  });
});
