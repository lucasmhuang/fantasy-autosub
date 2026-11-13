import { randomUUID } from "node:crypto";
import { appendEvent } from "@injurysub/db";
import { createEspnReadClient, type MatchupSide, type ScenarioName } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadCommissionerQueue, loadEspnStatus, loadRequestDetail } from "./commish";
import { insertInventedRequest, setWebEspn, type TeamWeekChange, webDbTest } from "./test-support";

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
});

describe("loadRequestDetail", () => {
  webDbTest(
    "gives the commissioner the request, why it needs them, and what to enter on ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter", withTeam1Adjustment(4, "Earlier sub"));
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
          // ESPN's 4.0 already on the side, plus this request's +5.1.
          adjustment: { currentTenths: 40, enterTenths: 91 },
        },
      });
      const reason =
        detail.status === "found" && detail.instructions.status === "ready"
          ? detail.instructions.adjustment?.reason
          : null;
      expect(reason).toMatch(/^Earlier sub \| .*Jeremiah Fears for Damian Lillard.*\+5\.1/);
    }
  );

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
