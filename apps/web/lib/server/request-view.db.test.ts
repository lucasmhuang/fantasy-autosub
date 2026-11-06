import { randomUUID } from "node:crypto";
import { appendEvent } from "@injurysub/db";
import { describe, expect } from "vitest";
import { loadRequestView, loadTeamHistory } from "./request-view";
import { insertInventedRequest, webDbTest } from "./test-support";

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
