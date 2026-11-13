import { randomUUID } from "node:crypto";
import { appendEvent, recordEspnAccess } from "@injurysub/db";
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

  webDbTest("doesn't show another team's request", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(db, { teamId: 2 });

    expect(await loadRequestView({ teamId: 1, requestId })).toEqual({ status: "not_found" });
    expect(await loadRequestView({ teamId: 1, requestId: "not-a-uuid" })).toEqual({
      status: "not_found",
    });
  });
});
