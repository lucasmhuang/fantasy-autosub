import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  readLeagueSettings,
  subRequestEvents,
  subRequestSnapshots,
  subRequests,
  writeLeagueSettings,
} from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import {
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "../../../../../lib/server/test-support";
import { POST as confirm } from "../../../../requests/route";
import { POST as saveSettings } from "../../settings/save/route";
import { POST as fileOnBehalf } from "../file/route";
import { POST as approve } from "./approve/route";
import { POST as complete } from "./complete/route";
import { POST as override } from "./override/route";
import { POST as reapprove } from "./reapprove/route";
import { POST as reject } from "./reject/route";
import { POST as reverse } from "./reverse/route";

const appOrigin = "http://localhost:3000";
const LILLARD = 6606;
const FEARS = 5144091;
type Action = typeof reject;

const line = (fantasyPoints: number) => ({
  fantasyPoints,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
});

function withLine(playerId: number, day: number, points: number, active: boolean): TeamWeekChange {
  return (read) => ({
    ...read,
    days: read.days.map((each) =>
      each.scoringPeriodId !== day
        ? each
        : {
            ...each,
            players: each.players.map((player) =>
              player.playerId === playerId ? { ...player, active, line: line(points) } : player
            ),
          }
    ),
  });
}

async function signedIn(db: DatabaseExecutor, role: "commissioner" | "manager", teamId: number) {
  const userId = await insertInventedUser(db, { role, teamId });
  return { userId, token: await insertSession(db, userId, new Date()) };
}

function form(
  path: string,
  token: string,
  fields: Record<string, string | string[]>,
  origin = appOrigin
) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) body.append(name, each);
  }
  return new NextRequest(`http://0.0.0.0:8080${path}`, {
    method: "POST",
    headers: {
      origin,
      cookie: `injurysub_session=${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

function act(action: Action, requestId: string, token: string, fields: Record<string, string>) {
  return action(form(`/commish/requests/${requestId}/x`, token, fields), {
    params: Promise.resolve({ id: requestId }),
  });
}

function statusParam(response: Response): string | null {
  expect(response.status).toBe(303);
  return new URL(response.headers.get("location") ?? "").searchParams.get("status");
}

async function requestRow(db: DatabaseExecutor, requestId: string) {
  return (await db.select().from(subRequests)).find((row) => row.requestId === requestId);
}

async function eventTypes(db: DatabaseExecutor, requestId: string) {
  return (await db.select().from(subRequestEvents))
    .filter((event) => event.requestId === requestId)
    .map((event) => event.eventType);
}

describe("the commissioner's actions on a request", () => {
  webDbTest("rejects with a reason the manager then sees", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db, { teamId: 4 });

    const response = await act(reject, requestId, token, {
      version: "0",
      reason: "He played that night.",
    });

    expect(statusParam(response)).toBe("rejected");
    expect(await requestRow(db, requestId)).toMatchObject({ status: "rejected", version: 1 });
    const events = await db.select().from(subRequestEvents);
    expect(events.find((event) => event.eventType === "rejected")?.payload).toEqual({
      reason: "He played that night.",
    });
  });

  webDbTest("keeps both the computed amount and the override", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db, { projectedAdjustmentTenths: 51 });

    const response = await act(override, requestId, token, { version: "0", amount: "-3.2" });

    expect(statusParam(response)).toBe("override_set");
    expect(await requestRow(db, requestId)).toMatchObject({
      status: "needs_review",
      projectedAdjustmentTenths: 51,
      overrideAdjustmentTenths: -32,
    });
    expect(await eventTypes(db, requestId)).toContain("override_set");
  });

  webDbTest(
    "records a manual completion for its effective day, recomputing the adjustment",
    async ({ database }) => {
      const { db } = database.connection;
      // Lillard started and scored 20.5 on day 7 and 8.1 on day 8; Fears scored 12.4 on day 8,
      // 3.0 of it before the request.
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }), (read) =>
        withLine(
          FEARS,
          8,
          12.4,
          false
        )(withLine(LILLARD, 8, 8.1, true)(withLine(LILLARD, 7, 20.5, true)(read)))
      );
      const { token } = await signedIn(db, "commissioner", 1);
      const requestId = await insertInventedRequest(db, {
        requestDay: 7,
        replacementPointsAtRequestTenths: 0,
      });

      const response = await act(complete, requestId, token, { version: "0", effectiveDay: "8" });

      expect(statusParam(response)).toBe("completed_manually");
      // E = 8: Lillard's credited day 7 comes off (-20.5); Fears's day-8 bench points don't
      // count as his days before E are only day 7, where he had none.
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "completed_manually",
        effectiveDay: 8,
        finalAdjustmentTenths: -205,
      });
      const phases = (await db.select().from(subRequestSnapshots))
        .filter((each) => each.requestId === requestId)
        .map((each) => each.phase);
      expect(phases).toContain("manual_completion");
    }
  );

  webDbTest(
    "records an adjustment-only settlement, the swap never taking effect",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }), (read) =>
        withLine(FEARS, 8, 12.4, false)(withLine(LILLARD, 7, 20.5, true)(read))
      );
      const { token } = await signedIn(db, "commissioner", 1);
      const requestId = await insertInventedRequest(db, { requestDay: 7 });

      const response = await act(complete, requestId, token, {
        version: "0",
        adjustmentOnly: "1",
      });

      expect(statusParam(response)).toBe("completed_manually");
      // Lillard keeps nothing (-20.5); Fears gets his bench points from the request on (+12.4).
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "completed_manually",
        effectiveDay: null,
        finalAdjustmentTenths: -81,
      });
      const events = await db.select().from(subRequestEvents);
      expect(
        events.find((event) => event.eventType === "completed_manually")?.payload
      ).toMatchObject({ adjustmentOnly: true });
    }
  );

  // X19, OQ9: once ESPN's week is past the request's matchup (period 2 in the scenario), its days
  // can't be re-read, so only an override settles it by hand.
  webDbTest(
    "refuses a completion without an override once ESPN's week has moved on",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const { token } = await signedIn(db, "commissioner", 1);
      const requestId = await insertInventedRequest(db, { matchupPeriodId: 1 });

      const response = await act(complete, requestId, token, { version: "0", effectiveDay: "8" });

      expect(statusParam(response)).toBe("week_moved_on");
      expect(await requestRow(db, requestId)).toMatchObject({ status: "needs_review", version: 0 });
    }
  );

  webDbTest("completes with the override once ESPN's week has moved on", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db, {
      matchupPeriodId: 1,
      projectedAdjustmentTenths: 51,
      overrideAdjustmentTenths: -25,
    });

    const response = await act(complete, requestId, token, { version: "0", effectiveDay: "8" });

    expect(statusParam(response)).toBe("completed_manually");
    expect(await requestRow(db, requestId)).toMatchObject({
      status: "completed_manually",
      effectiveDay: 8,
      finalAdjustmentTenths: -25,
    });
  });

  webDbTest(
    "refuses an effective day before the request's own once ESPN's week has moved on",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const { token } = await signedIn(db, "commissioner", 1);
      const requestId = await insertInventedRequest(db, {
        matchupPeriodId: 1,
        overrideAdjustmentTenths: -25,
      });

      const response = await act(complete, requestId, token, { version: "0", effectiveDay: "7" });

      expect(statusParam(response)).toBe("invalid_form");
      expect(await requestRow(db, requestId)).toMatchObject({ status: "needs_review", version: 0 });
    }
  );

  webDbTest(
    "reverses a processed substitution, keeping its starter from a new request that week",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const commissioner = await signedIn(db, "commissioner", 2);
      const manager = await signedIn(db, "manager", 1);
      const requestId = await insertInventedRequest(db, {
        status: "completed_manually",
        reviewReason: null,
        finalAdjustmentTenths: 51,
        effectiveDay: 8,
      });

      const response = await act(reverse, requestId, commissioner.token, { version: "0" });

      expect(statusParam(response)).toBe("reversed");
      expect(await requestRow(db, requestId)).toMatchObject({ status: "reversed" });
      const events = await db.select().from(subRequestEvents);
      expect(events.find((event) => event.eventType === "reversed")?.payload).toMatchObject({
        inverseTenths: -51,
      });
      const fields = {
        injured: String(LILLARD),
        replacement: "4601025",
        idempotencyKey: randomUUID(),
        edit: "6606:G>BE,4601025:BE>G",
        period: "2",
      };
      const again = await confirm(form("/requests", manager.token, fields));
      expect(statusParam(again)).toBe("active_request_exists");
    }
  );

  // The commissioner made the change on ESPN, so the request is no longer a rehearsal (S13).
  webDbTest(
    "drops the rehearsal mark from a rehearsed request completed by hand",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const { token } = await signedIn(db, "commissioner", 1);
      const requestId = await insertInventedRequest(db, { isRehearsal: true });

      const response = await act(complete, requestId, token, { version: "0", effectiveDay: "8" });

      expect(statusParam(response)).toBe("completed_manually");
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "completed_manually",
        isRehearsal: false,
      });
    }
  );

  // A rehearsal wrote no adjustment, so reversing it leaves nothing to take back on ESPN.
  webDbTest("gives a reversed rehearsal an inverse of zero", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db, {
      status: "completed",
      reviewReason: null,
      isRehearsal: true,
      finalAdjustmentTenths: -404,
    });

    const response = await act(reverse, requestId, token, { version: "0" });

    expect(statusParam(response)).toBe("reversed");
    const events = await db.select().from(subRequestEvents);
    expect(events.find((event) => event.eventType === "reversed")?.payload).toEqual({
      inverseTenths: 0,
    });
  });

  webDbTest("lets only the first of two simultaneous actions take effect", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db, { teamId: 4 });

    const responses = await Promise.all([
      act(reject, requestId, token, { version: "0", reason: "First tab." }),
      act(reject, requestId, token, { version: "0", reason: "Second tab." }),
    ]);

    expect(responses.map(statusParam).sort()).toEqual(["changed", "rejected"]);
    expect(await requestRow(db, requestId)).toMatchObject({ status: "rejected", version: 1 });
    expect((await eventTypes(db, requestId)).filter((type) => type === "rejected")).toHaveLength(1);
  });

  // A browser's maxLength counts a line break as one character, then sends it as CRLF.
  webDbTest(
    "accepts a 500-character reason whose line breaks arrive as CRLF",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedIn(db, "commissioner", 1);
      const requestId = await insertInventedRequest(db);
      const reason = `${"a".repeat(249)}\r\n${"b".repeat(250)}`;

      const response = await act(reject, requestId, token, { version: "0", reason });

      expect(statusParam(response)).toBe("rejected");
    }
  );

  // Q13: an action applies only to the version the form showed; a form without one showed none.
  webDbTest("refuses an action whose form carries no version", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db);

    const statuses = [];
    for (const version of [undefined, "", " "]) {
      const fields: Record<string, string> = { reason: "No longer needed" };
      if (version !== undefined) fields.version = version;
      statuses.push(statusParam(await act(reject, requestId, token, fields)));
    }

    expect(statuses).toEqual(["invalid_form", "invalid_form", "invalid_form"]);
    expect(await requestRow(db, requestId)).toMatchObject({ status: "needs_review", version: 0 });
  });

  webDbTest("refuses every action from a manager, changing nothing", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "manager", 1);
    const requestId = await insertInventedRequest(db, {
      status: "completed_manually",
      reviewReason: null,
    });

    for (const action of [approve, reapprove, reject, override, complete, reverse]) {
      const response = await act(action, requestId, token, {
        version: "0",
        reason: "x",
        amount: "1.0",
        effectiveDay: "8",
      });
      expect(response.status).toBe(403);
    }
    expect(await requestRow(db, requestId)).toMatchObject({
      status: "completed_manually",
      version: 0,
    });
  });
});

// Lillard scored 20.5 while starting on day 7, the request's day. Approved on ESPN's day 8, the
// swap would take effect that day, so those points come off: -20.5.
const LILLARD_OWED = -205;
const HOUR_MS = 3_600_000;

function lillardScoredOnDay7(): void {
  setWebEspn(
    createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }),
    withLine(LILLARD, 7, 20.5, true)
  );
}

async function automationOnFor(db: DatabaseExecutor, userId: string, teams: number[]) {
  await writeLeagueSettings(db, {
    executionMode: "approval_required",
    writeAllowlist: teams,
    updatedBy: userId,
    now: new Date(),
    shownUpdatedAt: null,
  });
}

// A request for team 1 waiting for approval, filed on day 7, with automation on for team 1.
async function awaitingApproval(
  db: DatabaseExecutor,
  commissionerTeam: number,
  overrides: Parameters<typeof insertInventedRequest>[1] = {}
) {
  const { userId, token } = await signedIn(db, "commissioner", commissionerTeam);
  await automationOnFor(db, userId, [1]);
  const requestId = await insertInventedRequest(db, {
    status: "awaiting_approval",
    reviewReason: null,
    requestDay: 7,
    ...overrides,
  });
  return { token, requestId };
}

async function eventPayload(db: DatabaseExecutor, requestId: string, eventType: string) {
  return (await db.select().from(subRequestEvents)).find(
    (event) => event.requestId === requestId && event.eventType === eventType
  )?.payload;
}

const shown = { version: "0", shownTenths: String(LILLARD_OWED) };

describe("approving a request", () => {
  webDbTest(
    "queues it with the amount computed now, recorded as approved",
    async ({ database }) => {
      const { db } = database.connection;
      lillardScoredOnDay7();
      const { token, requestId } = await awaitingApproval(db, 2);

      const response = await act(approve, requestId, token, shown);

      expect(statusParam(response)).toBe("approved");
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "queued",
        reviewReason: null,
        approvedComputedTenths: LILLARD_OWED,
        version: 1,
      });
      expect(await eventPayload(db, requestId, "approved")).toMatchObject({
        computedTenths: LILLARD_OWED,
        overrideTenths: null,
        selfApproval: false,
        lineupState: "pending",
        effectiveDay: null,
      });
    }
  );

  // Q12, OQ2: the commissioner approves their own team's request, and the record says so.
  webDbTest("records the commissioner approving their own team's request", async ({ database }) => {
    const { db } = database.connection;
    lillardScoredOnDay7();
    const { token, requestId } = await awaitingApproval(db, 1);

    expect(statusParam(await act(approve, requestId, token, shown))).toBe("approved");

    expect(await eventPayload(db, requestId, "approved")).toMatchObject({ selfApproval: true });
  });

  webDbTest.for(["suspension", "stale"] as const)(
    "approves a request in review for %s",
    async (reviewReason, { database }) => {
      const { db } = database.connection;
      lillardScoredOnDay7();
      const { token, requestId } = await awaitingApproval(db, 2, {
        status: "needs_review",
        reviewReason,
      });

      expect(statusParam(await act(approve, requestId, token, shown))).toBe("approved");

      expect(await requestRow(db, requestId)).toMatchObject({ status: "queued" });
    }
  );

  webDbTest(
    "refuses a request in review because automation was off when it was filed",
    async ({ database }) => {
      const { db } = database.connection;
      lillardScoredOnDay7();
      const { token, requestId } = await awaitingApproval(db, 2, {
        status: "needs_review",
        reviewReason: "automation_off",
      });

      expect(statusParam(await act(approve, requestId, token, shown))).toBe("not_allowed");

      expect(await requestRow(db, requestId)).toMatchObject({ status: "needs_review", version: 0 });
    }
  );

  // AC2-1: the wait starts again at the approval, however long ago the request was filed.
  webDbTest(
    "gives an expired request approved 20 hours after filing 12 more hours",
    async ({ database }) => {
      const { db } = database.connection;
      lillardScoredOnDay7();
      const filed = new Date(Date.now() - 20 * HOUR_MS);
      const { token, requestId } = await awaitingApproval(db, 2, {
        status: "needs_review",
        reviewReason: "expired",
        createdAt: filed,
        filedAt: filed,
        requestMoment: filed,
        expiresAt: new Date(filed.getTime() + 12 * HOUR_MS),
      });
      const before = Date.now();

      expect(statusParam(await act(approve, requestId, token, shown))).toBe("approved");

      const expiresAt = (await requestRow(db, requestId))?.expiresAt?.getTime() ?? 0;
      expect(expiresAt).toBeGreaterThanOrEqual(before + 12 * HOUR_MS);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 12 * HOUR_MS);
    }
  );

  // Q19: the message names which gate is closed.
  webDbTest.for([
    { teams: [], status: "automation_off" },
    { teams: [2], status: "not_allowlisted" },
  ])(
    "refuses while the write gate is closed ($status), changing nothing",
    async (gate, { database }) => {
      const { db } = database.connection;
      lillardScoredOnDay7();
      const { userId, token } = await signedIn(db, "commissioner", 2);
      await automationOnFor(db, userId, gate.teams);
      const requestId = await insertInventedRequest(db, {
        reviewReason: "suspension",
        requestDay: 7,
      });

      expect(statusParam(await act(approve, requestId, token, shown))).toBe(gate.status);

      expect(await requestRow(db, requestId)).toMatchObject({ status: "needs_review", version: 0 });
    }
  );

  webDbTest(
    "refuses once the matchup week has ended, the lineup never having been written",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "week-concluded" }));
      const { token, requestId } = await awaitingApproval(db, 2);

      expect(statusParam(await act(approve, requestId, token, shown))).toBe("week_ended");

      expect(await requestRow(db, requestId)).toMatchObject({
        status: "awaiting_approval",
        version: 0,
      });
    }
  );

  // Q18: the form carries the amount its page showed.
  webDbTest(
    "refuses when the amount is no longer the one the page showed",
    async ({ database }) => {
      const { db } = database.connection;
      lillardScoredOnDay7();
      const { token, requestId } = await awaitingApproval(db, 2);

      const response = await act(approve, requestId, token, { version: "0", shownTenths: "-100" });

      expect(statusParam(response)).toBe("amount_changed");
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "awaiting_approval",
        approvedComputedTenths: null,
        version: 0,
      });
    }
  );

  webDbTest("refuses while ESPN can't be read, recording nothing", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("espn_unavailable");
    const { token, requestId } = await awaitingApproval(db, 2);

    expect(statusParam(await act(approve, requestId, token, shown))).toBe("espn_unreachable");

    expect(await requestRow(db, requestId)).toMatchObject({
      status: "awaiting_approval",
      version: 0,
    });
  });

  webDbTest("refuses an approval from a page showing an older version", async ({ database }) => {
    const { db } = database.connection;
    lillardScoredOnDay7();
    const { token, requestId } = await awaitingApproval(db, 2);

    const response = await act(approve, requestId, token, { ...shown, version: "3" });

    expect(statusParam(response)).toBe("changed");
    expect(await requestRow(db, requestId)).toMatchObject({ status: "awaiting_approval" });
  });
});

// A request whose adjustment the executor held: the amount it computed is on the hold's event.
async function heldAdjustment(
  db: DatabaseExecutor,
  overrides: Parameters<typeof insertInventedRequest>[1] = {}
) {
  const { userId, token } = await signedIn(db, "commissioner", 2);
  await automationOnFor(db, userId, [1]);
  const requestId = await insertInventedRequest(db, {
    reviewReason: "adjustment_changed",
    lineupState: "verified",
    effectiveDay: 8,
    adjustmentState: "held",
    approvedComputedTenths: -300,
    ...overrides,
  });
  await appendEvent(db, requestId, {
    eventId: randomUUID(),
    actorType: "system",
    actorUserId: null,
    eventType: "sent_to_review",
    payload: { reason: "adjustment_changed", computedTenths: -404, approvedComputedTenths: -300 },
    createdAt: new Date(),
  });
  return { token, requestId };
}

describe("re-approving a held adjustment", () => {
  // Its lineup is on ESPN, so nothing about the swap is read again, and ESPN isn't needed.
  webDbTest(
    "queues it for the adjustment alone, approving the held amount without reading ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      setRefusingWebEspn("espn_unavailable");
      const { token, requestId } = await heldAdjustment(db);

      const response = await act(reapprove, requestId, token, { version: "0" });

      expect(statusParam(response)).toBe("reapproved");
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "queued",
        lineupState: "verified",
        adjustmentState: "pending",
        approvedComputedTenths: -404,
      });
      expect(await eventPayload(db, requestId, "reapproved")).toMatchObject({
        computedTenths: -404,
        lineupState: "verified",
        effectiveDay: 8,
      });
    }
  );

  // A rehearsed hold starts again at the lineup, which a finished week can't take (AC4-6).
  webDbTest(
    "refuses after the week ended when the held request's lineup isn't on ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "week-concluded" }));
      const { token, requestId } = await heldAdjustment(db, {
        lineupState: "pending",
        effectiveDay: null,
        isRehearsal: true,
      });

      const response = await act(reapprove, requestId, token, { version: "0" });

      expect(statusParam(response)).toBe("week_ended");
      expect(await requestRow(db, requestId)).toMatchObject({ status: "needs_review", version: 0 });
    }
  );
});

describe("the commissioner's settings", () => {
  webDbTest(
    "switches to auto, allows team 1, then turns automation off, each read back",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedIn(db, "commissioner", 1);
      const save = (fields: Record<string, string | string[]>) =>
        saveSettings(form("/commish/settings/save", token, fields));

      expect(
        statusParam(await save({ executionMode: "auto", team: ["1"], shownUpdatedAt: "" }))
      ).toBe("saved");
      const saved = await readLeagueSettings(db);
      expect(saved).toMatchObject({ executionMode: "auto", writeAllowlist: [1] });

      const shownUpdatedAt = saved.updatedAt?.toISOString() ?? "";
      expect(statusParam(await save({ executionMode: "auto", shownUpdatedAt }))).toBe("saved");
      expect(await readLeagueSettings(db)).toMatchObject({ writeAllowlist: [] });
    }
  );

  // Q2, O11: automation turned off on one device stays off when an older tab saves.
  webDbTest(
    "refuses a save from a tab showing older settings, keeping the later change",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedIn(db, "commissioner", 1);
      const save = (fields: Record<string, string | string[]>) =>
        saveSettings(form("/commish/settings/save", token, fields));
      await save({ executionMode: "auto", team: ["1"], shownUpdatedAt: "" });
      const shownUpdatedAt = (await readLeagueSettings(db)).updatedAt?.toISOString() ?? "";
      await save({ executionMode: "auto", shownUpdatedAt });

      const stale = await save({ executionMode: "approval_required", team: ["1"], shownUpdatedAt });

      expect(statusParam(stale)).toBe("settings_changed");
      expect(await readLeagueSettings(db)).toMatchObject({
        executionMode: "auto",
        writeAllowlist: [],
      });
    }
  );

  webDbTest("refuses a manager's settings change", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "manager", 1);

    const response = await saveSettings(
      form("/commish/settings/save", token, { executionMode: "auto", team: ["1"] })
    );

    expect(response.status).toBe(403);
    expect(await readLeagueSettings(db)).toMatchObject({ executionMode: "approval_required" });
  });
});

// Q14, RS11: each commissioner POST refuses another site and sends a visitor without a session to
// sign in, before it reads the form or changes anything.
describe("every commissioner POST", () => {
  type Post = (request: NextRequest) => Promise<Response>;

  function posts(requestId: string): [string, Post][] {
    const params = { params: Promise.resolve({ id: requestId }) };
    return [
      ["approve", (request) => approve(request, params)],
      ["reapprove", (request) => reapprove(request, params)],
      ["reject", (request) => reject(request, params)],
      ["override", (request) => override(request, params)],
      ["complete", (request) => complete(request, params)],
      ["reverse", (request) => reverse(request, params)],
      ["settings", (request) => saveSettings(request)],
      ["file", (request) => fileOnBehalf(request)],
    ];
  }

  const fields = {
    version: "0",
    reason: "x",
    amount: "1.0",
    effectiveDay: "8",
    executionMode: "auto",
    team: ["1"],
  };

  webDbTest("refuses each one sent from another site, changing nothing", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", 1);
    const requestId = await insertInventedRequest(db, { status: "completed_manually" });

    const statuses: Record<string, number> = {};
    for (const [name, post] of posts(requestId)) {
      statuses[name] = (
        await post(form("/commish/x", token, fields, "https://evil.example"))
      ).status;
    }

    expect(Object.values(statuses)).toEqual(Array(8).fill(403));
    expect(await db.select().from(subRequests)).toMatchObject([
      { status: "completed_manually", version: 0 },
    ]);
    expect(await readLeagueSettings(db)).toMatchObject({ executionMode: "approval_required" });
  });

  webDbTest(
    "sends each one without a live session to sign in, changing nothing",
    async ({ database }) => {
      const { db } = database.connection;
      const requestId = await insertInventedRequest(db, { status: "completed_manually" });

      const paths: Record<string, string | null> = {};
      for (const [name, post] of posts(requestId)) {
        const response = await post(form("/commish/x", `token-${randomUUID()}`, fields));
        expect(response.status).toBe(303);
        paths[name] = new URL(response.headers.get("location") ?? "").pathname;
      }

      expect(Object.values(paths)).toEqual(Array(8).fill("/login"));
      expect(await db.select().from(subRequests)).toMatchObject([
        { status: "completed_manually", version: 0 },
      ]);
      expect(await readLeagueSettings(db)).toMatchObject({ executionMode: "approval_required" });
    }
  );
});
