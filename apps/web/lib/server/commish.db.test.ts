import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  recordEspnAccess,
  writeLeagueSettings,
} from "@injurysub/db";
import { type LineupMove, planRecord } from "@injurysub/domain";
import { createEspnReadClient, type MatchupSide, type ScenarioName } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadCommissionerQueue, loadEspnStatus, loadRequestDetail } from "./commish";
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

describe("loadCommissionerQueue", () => {
  webDbTest(
    "lists every team's requests, those needing action first, longest-waiting first",
    async ({ database }) => {
      const { db } = database.connection;
      const done = await insertInventedRequest(db, {
        teamId: 2,
        status: "completed",
        reviewReason: null,
        createdAt: at(30),
      });
      const review = await insertInventedRequest(db, { teamId: 3, createdAt: at(10) });
      const approval = await insertInventedRequest(db, {
        status: "awaiting_approval",
        reviewReason: null,
        createdAt: at(20),
      });

      const queue = await loadCommissionerQueue();

      expect(queue.status === "found" && queue.requests).toMatchObject([
        {
          requestId: review,
          teamId: 3,
          needsAction: true,
          why: expect.stringContaining("automation is off"),
        },
        { requestId: approval, teamId: 1, needsAction: true, why: "it waits for your approval" },
        { requestId: done, teamId: 2, needsAction: false, why: null },
      ]);
    }
  );

  webDbTest(
    "marks a request in line as blocked while ESPN refuses the cookie",
    async ({ database }) => {
      const { db } = database.connection;
      const queued = await insertInventedRequest(db, { status: "queued", reviewReason: null });
      const review = await insertInventedRequest(db, { teamId: 3 });
      await recordEspnAccess(db, {
        state: "credentials_rejected",
        code: "credentials_rejected",
        checkedAt: at(5),
      });

      const queue = await loadCommissionerQueue();
      const detail = await loadRequestDetail({ requestId: queued });

      expect(queue.status === "found" && queue.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ requestId: queued, blocked: "credentials_rejected" }),
          expect.objectContaining({ requestId: review, blocked: null }),
        ])
      );
      expect(detail).toMatchObject({ status: "found", blocked: "credentials_rejected" });
    }
  );
});

describe("loadRequestDetail", () => {
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

describe("loadEspnStatus", () => {
  webDbTest("says ESPN is working when the league's rules match", async () => {
    scripted("one-out-starter");

    expect(await loadEspnStatus()).toMatchObject({ state: "working", mismatches: [] });
  });

  webDbTest("names the league settings that differ", async () => {
    scripted("rules-mismatch");

    const status = await loadEspnStatus();

    expect(status.state).toBe("rules_mismatch");
    expect(status.mismatches.length).toBeGreaterThan(0);
  });

  webDbTest("says when ESPN refuses the credentials, with when it checked", async () => {
    scripted("credentials-rejected");

    expect(await loadEspnStatus()).toMatchObject({
      state: "credentials_rejected",
      checkedAt: expect.any(String),
    });
  });
});
