import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  emailOutbox,
  enqueueEmail,
  recordEspnAccess,
  recordTeamNames,
  writeLeagueSettings,
} from "@injurysub/db";
import { type LineupMove, planRecord } from "@injurysub/domain";
import { createEspnReadClient, type MatchupSide, type ScenarioName } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadRequestDetail } from "./commish";
import {
  insertInventedRequest,
  insertInventedUser,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "./test-support";

const at = (minute: number) => new Date(`2026-10-28T01:${String(minute).padStart(2, "0")}:00Z`);

function scripted(scenario: ScenarioName, change?: TeamWeekChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario }), change);
}

// Team 1's side of its matchup with an adjustment ESPN already holds.
function withTeam1Adjustment(adjustment: number, adjustmentReason: string): TeamWeekChange {
  const adjust = (side: MatchupSide): MatchupSide =>
    side.teamId === 1 ? { ...side, adjustment, adjustmentReason } : side;
  return (read) =>
    read.matchup === null
      ? read
      : {
          ...read,
          matchup: {
            ...read.matchup,
            home: adjust(read.matchup.home),
            away: read.matchup.away === null ? null : adjust(read.matchup.away),
          },
        };
}

const projection = {
  projection: {
    totalTenths: 51,
    lines: [{ day: 8, playerId: 5144091, tenths: 51, why: "replacement_after_request" }],
  },
};

describe("loadRequestDetail", () => {
  webDbTest(
    "marks a request in line as blocked while ESPN refuses the cookie",
    async ({ database }) => {
      const { db } = database.connection;
      const queued = await insertInventedRequest(db, { status: "queued", reviewReason: null });
      await recordEspnAccess(db, {
        state: "credentials_rejected",
        code: "credentials_rejected",
        checkedAt: at(5),
      });

      expect(await loadRequestDetail({ requestId: queued })).toMatchObject({
        status: "found",
        blocked: "credentials_rejected",
      });
    }
  );

  webDbTest(
    "gives the commissioner the request, why it needs them, and what to enter on ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      // ESPN's Scoreboard lists the team by its name now, under its matchup period's number.
      const adjusted = withTeam1Adjustment(4, "Earlier sub");
      scripted("one-out-starter", (read) => {
        const changed = adjusted(read);
        return { ...changed, lineup: { ...changed.lineup, teamName: "Invented Hoopers" } };
      });
      const requestId = await insertInventedRequest(
        db,
        { projectedAdjustmentTenths: 51, requestMoment: new Date("2026-10-28T02:10:00Z") },
        projection
      );

      const detail = await loadRequestDetail({ requestId });

      expect(detail).toMatchObject({
        status: "found",
        request: { teamId: 1, injuredName: "Damian Lillard", replacementName: "Jeremiah Fears" },
        why: expect.stringContaining("automation is off"),
        actions: ["reject", "override", "complete"],
        breakdown: [{ day: 8, name: "Jeremiah Fears", tenths: 51 }],
        instructions: {
          status: "ready",
          lineupMoves: [
            { name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
            { name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" },
          ],
          // ESPN's 4.0 already on the side, plus this request's +5.1, in matchup period 2.
          adjustment: {
            matchupPeriodId: 2,
            teamName: "Invented Hoopers",
            currentTenths: 40,
            enterTenths: 91,
          },
        },
      });
      const reason =
        detail.status === "found" && detail.instructions.status === "ready"
          ? detail.instructions.adjustment?.reason
          : null;
      expect(reason).toMatch(/^Earlier sub \| .*Jeremiah Fears for Damian Lillard.*\+5\.1/);
    }
  );

  // Lillard out, Edey in: Edey takes a UTIL once a UTIL starter who can play G moves to G. On the
  // scenario's lineup only the UTIL guard can.
  const edeyForLillard = {
    status: "awaiting_approval" as const,
    reviewReason: null,
    replacementPlayerId: 4600663,
    replacementName: "Zach Edey",
  };
  const viaUtil = (playerId: number): LineupMove[] => [
    { playerId: 6606, fromSlot: "G", toSlot: "BE" },
    { playerId, fromSlot: "UTIL", toSlot: "G" },
    { playerId: 4600663, fromSlot: "BE", toSlot: "UTIL" },
  ];

  async function nameOf(playerId: number): Promise<string | undefined> {
    const read = await createEspnReadClient({
      mode: "scripted",
      scenario: "one-out-starter",
    }).getTeamWeek(1);
    return read.lineup.starters.find(({ player }) => player?.playerId === playerId)?.player?.name;
  }

  webDbTest(
    "shows the edit that would be sent now beside the one confirmed, when they differ",
    async ({ database }) => {
      scripted("one-out-starter");
      const confirmed = viaUtil(4278562);
      const requestId = await insertInventedRequest(database.connection.db, edeyForLillard, {
        ...planRecord({ items: confirmed, movedStarters: 1 }),
      });

      const detail = await loadRequestDetail({ requestId });

      const named = async (moves: LineupMove[]) =>
        Promise.all(
          moves.map(async ({ playerId, fromSlot, toSlot }) => ({
            name:
              playerId === 6606
                ? "Damian Lillard"
                : playerId === 4600663
                  ? "Zach Edey"
                  : await nameOf(playerId),
            fromSlot,
            toSlot,
          }))
        );
      expect(detail).toMatchObject({
        status: "found",
        instructions: {
          status: "ready",
          lineupMoves: await named(viaUtil(4900671)),
          confirmedMoves: await named(confirmed),
        },
      });
    }
  );

  webDbTest("shows only the edit now while it's the one confirmed", async ({ database }) => {
    scripted("one-out-starter");
    const requestId = await insertInventedRequest(database.connection.db, edeyForLillard, {
      ...planRecord({ items: viaUtil(4900671), movedStarters: 1 }),
    });

    const detail = await loadRequestDetail({ requestId });

    expect(detail).toMatchObject({
      instructions: { status: "ready", lineupMoves: expect.any(Array), confirmedMoves: null },
    });
  });

  // ESPN stored a 1,000-character reason whole (team 1, 2026-11-13); its limit wasn't reached.
  async function adjustmentStepWith(
    db: Parameters<typeof insertInventedRequest>[0],
    existing: string
  ) {
    scripted("one-out-starter", withTeam1Adjustment(4, existing));
    const requestId = await insertInventedRequest(
      db,
      { projectedAdjustmentTenths: 51, requestMoment: new Date("2026-10-28T02:10:00Z") },
      projection
    );
    const detail = await loadRequestDetail({ requestId });
    return detail.status === "found" && detail.instructions.status === "ready"
      ? detail.instructions.adjustment
      : null;
  }

  webDbTest(
    "gives a reason to enter of up to the 1,000 characters ESPN is known to store",
    async ({ database }) => {
      const step = await adjustmentStepWith(database.connection.db, "x".repeat(600));

      expect(step?.reasonTooLong).toBe(false);
      expect(step?.reason?.length).toBeGreaterThan(600);
      expect(step?.reason?.length).toBeLessThanOrEqual(1000);
    }
  );

  webDbTest("says a reason past 1,000 characters is too long to enter", async ({ database }) => {
    const step = await adjustmentStepWith(database.connection.db, "y".repeat(990));

    expect(step?.reasonTooLong).toBe(true);
  });

  webDbTest("keeps every event and snapshot of the request's record", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const requestId = await insertInventedRequest(db);
    await appendEvent(db, requestId, {
      eventId: randomUUID(),
      actorType: "commissioner",
      actorUserId: null,
      eventType: "override_set",
      payload: { overrideTenths: 30 },
      createdAt: at(40),
    });

    const detail = await loadRequestDetail({ requestId });

    expect(detail.status === "found" && detail.events.map((event) => event.eventType)).toEqual([
      "request_filed",
      "override_set",
    ]);
    expect(detail.status === "found" && detail.snapshots.map((each) => each.phase)).toEqual([
      "request",
    ]);
  });

  // Q8: an override is kept beside the computed amount, never in its place.
  webDbTest(
    "keeps the computed amount beside an override not yet applied",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const requestId = await insertInventedRequest(db, {
        projectedAdjustmentTenths: 51,
        overrideAdjustmentTenths: -25,
      });

      const detail = await loadRequestDetail({ requestId });

      expect(detail.status === "found" && detail.adjustment).toEqual({
        computedTenths: 51,
        overrideTenths: -25,
        appliedTenths: null,
      });
    }
  );

  webDbTest(
    "gives a completed request's applied amount, and the amount computed at completion",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const requestId = await insertInventedRequest(db, {
        status: "completed_manually",
        reviewReason: null,
        projectedAdjustmentTenths: 51,
        overrideAdjustmentTenths: -25,
        finalAdjustmentTenths: -25,
      });
      await appendEvent(db, requestId, {
        eventId: randomUUID(),
        actorType: "commissioner",
        actorUserId: null,
        eventType: "completed_manually",
        payload: {
          effectiveDay: 9,
          adjustmentOnly: false,
          computedTenths: 40,
          overrideTenths: -25,
        },
        createdAt: at(40),
      });

      const detail = await loadRequestDetail({ requestId });

      expect(detail.status === "found" && detail.adjustment).toEqual({
        computedTenths: 40,
        overrideTenths: -25,
        appliedTenths: -25,
      });
    }
  );

  // Q16, H2: what the commissioner attested for a request filed on a team's behalf.
  webDbTest(
    "shows what an on-behalf filing attested, beside ESPN at filing",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const attestation = {
        designation: "OUT",
        replacementGame: "in_progress",
        enteredTenths: 32,
        note: "Screenshot from the manager",
      };
      const requestId = await insertInventedRequest(
        db,
        {
          kind: "on_behalf",
          requestMoment: new Date("2026-10-28T01:00:00Z"),
          filedAt: new Date("2026-10-28T03:30:00Z"),
          designationAtRequest: "OUT",
          designationAtFiling: "ACTIVE",
          attestedFields: ["designation", "replacement_game", "points_at_request"],
        },
        {},
        { status: "needs_review", reviewReason: "automation_off", attestation }
      );
      const ownRequestId = await insertInventedRequest(db, { teamId: 2 });

      const detail = await loadRequestDetail({ requestId });
      const own = await loadRequestDetail({ requestId: ownRequestId });

      expect(detail.status === "found" && detail.filing).toEqual({
        statedMoment: new Date("2026-10-28T01:00:00Z"),
        filedAt: new Date("2026-10-28T03:30:00Z"),
        designation: "OUT",
        designationAtFiling: "ACTIVE",
        replacementGame: "in_progress",
        enteredTenths: 32,
        note: "Screenshot from the manager",
        attestedFields: ["designation", "replacement_game", "points_at_request"],
      });
      expect(own.status === "found" && own.filing).toBeNull();
    }
  );

  webDbTest("finds no request for an unknown id", async () => {
    expect(await loadRequestDetail({ requestId: randomUUID() })).toEqual({ status: "not_found" });
    expect(await loadRequestDetail({ requestId: "not-a-uuid" })).toEqual({ status: "not_found" });
  });
});

async function automationOnForTeam1(db: DatabaseExecutor) {
  await writeLeagueSettings(db, {
    executionMode: "approval_required",
    writeAllowlist: [1],
    updatedBy: await insertInventedUser(db, { role: "commissioner", teamId: 2 }),
    now: at(0),
    shownUpdatedAt: null,
  });
}

// Fears had 3.0 points when the request was made on day 8, ESPN's day now: approved today, the
// swap would take effect today, so those 3.0 come off.
const waitingForApproval = {
  status: "awaiting_approval",
  reviewReason: null,
  replacementPointsAtRequestTenths: 30,
} as const;

describe("loadRequestDetail: what the commissioner can approve", () => {
  webDbTest(
    "offers approval with the amount computed from ESPN now, while automation covers the team",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      await automationOnForTeam1(db);
      const requestId = await insertInventedRequest(db, {
        ...waitingForApproval,
        overrideAdjustmentTenths: 12,
      });

      const detail = await loadRequestDetail({ requestId });

      expect(detail).toMatchObject({
        actions: ["approve", "reject", "override", "complete"],
        approval: { action: "approve", computedTenths: -30, overrideTenths: 12 },
      });
    }
  );

  webDbTest("offers no approval while automation is off", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const requestId = await insertInventedRequest(db, waitingForApproval);

    const detail = await loadRequestDetail({ requestId });

    expect(detail).toMatchObject({ actions: ["reject", "override", "complete"], approval: null });
  });

  // Without ESPN's week neither the week's end nor the amount is known.
  webDbTest("offers no approval while ESPN can't be read", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("espn_unavailable");
    await automationOnForTeam1(db);
    const requestId = await insertInventedRequest(db, waitingForApproval);

    const detail = await loadRequestDetail({ requestId });

    expect(detail).toMatchObject({ actions: ["reject", "override", "complete"], approval: null });
  });

  webDbTest(
    "offers re-approval of a held adjustment at the held amount, with ESPN unread",
    async ({ database }) => {
      const { db } = database.connection;
      setRefusingWebEspn("espn_unavailable");
      await automationOnForTeam1(db);
      const requestId = await insertInventedRequest(db, {
        reviewReason: "adjustment_held_rules",
        lineupState: "verified",
        effectiveDay: 8,
        adjustmentState: "held",
      });
      await appendEvent(db, requestId, {
        eventId: randomUUID(),
        actorType: "system",
        actorUserId: null,
        eventType: "sent_to_review",
        payload: { reason: "adjustment_held_rules", computedTenths: -404, mismatches: [] },
        createdAt: at(30),
      });

      const detail = await loadRequestDetail({ requestId });

      expect(detail).toMatchObject({
        actions: ["reapprove", "override", "complete"],
        approval: { action: "reapprove", computedTenths: -404, overrideTenths: null },
      });
    }
  );
});

describe("loadRequestDetail: a request held for an earlier credit (A20)", () => {
  async function insertChained(db: DatabaseExecutor, override: number | null) {
    const earlierRequestId = randomUUID();
    const requestId = await insertInventedRequest(db, {
      status: "needs_review",
      reviewReason: "adjustment_failed",
      lineupState: "verified",
      adjustmentState: "held",
      projectedAdjustmentTenths: -50,
      overrideAdjustmentTenths: override,
    });
    await appendEvent(db, requestId, {
      eventId: randomUUID(),
      actorType: "system",
      actorUserId: null,
      eventType: "sent_to_review",
      payload: { reason: "adjustment_failed", detail: "chained_credit", earlierRequestId },
      createdAt: at(30),
    });
    return { requestId, earlierRequestId };
  }

  webDbTest(
    "offers no amount to enter, naming the earlier request, until the commissioner sets one",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const { requestId, earlierRequestId } = await insertChained(db, null);

      const detail = await loadRequestDetail({ requestId });

      expect(detail).toMatchObject({
        status: "found",
        instructions: { status: "ready", adjustment: null, heldForEarlier: { earlierRequestId } },
      });
    }
  );

  webDbTest("offers the commissioner's own amount once they set one", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const { requestId } = await insertChained(db, -30);

    const detail = await loadRequestDetail({ requestId });

    expect(detail).toMatchObject({
      status: "found",
      instructions: { status: "ready", adjustment: { enterTenths: -30 } },
    });
  });
});

describe("loadRequestDetail: names, what approving sends, and the alert email", () => {
  webDbTest(
    "names the team and whoever asked, a disabled account too, and on-behalf the team's manager",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      await recordTeamNames(db, { teams: [{ teamId: 1, name: "Invented Team One" }], now: at(0) });
      const gone = await insertInventedUser(db, { isActive: false });
      const asked = await insertInventedRequest(db, { requestedBy: gone });
      await insertInventedUser(db, { teamId: 2 });
      const filed = await insertInventedRequest(db, {
        kind: "on_behalf",
        teamId: 2,
        requestedBy: await insertInventedUser(db, { role: "commissioner", teamId: 1 }),
      });

      expect(await loadRequestDetail({ requestId: asked })).toMatchObject({
        names: { team: "Invented Team One", manager: "Invented Person" },
      });
      expect(await loadRequestDetail({ requestId: filed })).toMatchObject({
        // No stored name for team 2, so ESPN's own, from the live read.
        names: { team: "Team 2", manager: "Invented Person" },
      });
    }
  );

  webDbTest(
    "lists what approving sends: each move with its player, and the side's total before and after",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      await automationOnForTeam1(db);
      const requestId = await insertInventedRequest(db, {
        ...waitingForApproval,
        overrideAdjustmentTenths: 12,
      });

      const detail = await loadRequestDetail({ requestId });

      expect(detail.status === "found" && detail.sends?.moves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ playerId: 6606, fromSlot: "G", toSlot: "BE" }),
          expect.objectContaining({ playerId: 5144091, toSlot: "G" }),
        ])
      );
      const sends = detail.status === "found" ? detail.sends : null;
      expect(sends?.amountTenths).toBe(12);
      expect(sends && sends.sideAfterTenths - sends.sideBeforeTenths).toBe(12);
    }
  );

  webDbTest("sends nothing listed when no approval is on offer", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const requestId = await insertInventedRequest(db, waitingForApproval);

    expect(await loadRequestDetail({ requestId })).toMatchObject({ sends: null });
  });

  webDbTest("says whether the alert email went out while it waits on you", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const requestId = await insertInventedRequest(db);
    await enqueueEmail(db, {
      emailId: randomUUID(),
      dedupeKey: `${requestId}:0`,
      toAddress: "commissioner@example.test",
      subject: "invented",
      body: "invented",
      requestId,
      createdAt: at(1),
    });
    await db.update(emailOutbox).set({ failedAt: at(2), failureCode: "send_rejected" });

    expect(await loadRequestDetail({ requestId })).toMatchObject({
      alertEmail: { state: "failed", at: at(2), code: "send_rejected" },
    });
  });
});

describe("loadRequestDetail: the facts its status line names", () => {
  webDbTest("gives a review the same facts the queue's row names", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("espn_unavailable");
    const requestId = await insertInventedRequest(db, { reviewReason: "adjustment_failed" });
    await appendEvent(db, requestId, {
      eventId: randomUUID(),
      actorType: "system",
      eventType: "adjustment_sent",
      payload: { finalTenths: -194, targetTenths: 0 },
      createdAt: at(3),
    });

    expect(await loadRequestDetail({ requestId })).toMatchObject({
      facts: { sentTenths: -194 },
    });
  });

  webDbTest("says since when ESPN's access has held a request up", async ({ database }) => {
    const { db } = database.connection;
    const queued = await insertInventedRequest(db, { status: "queued", reviewReason: null });
    await recordEspnAccess(db, {
      state: "credentials_rejected",
      code: "credentials_rejected",
      checkedAt: at(5),
    });

    expect(await loadRequestDetail({ requestId: queued })).toMatchObject({
      blocked: "credentials_rejected",
      blockedSince: at(5),
      facts: null,
    });
  });
});
