import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  emailOutbox,
  subRequestEvents,
  subRequestSnapshots,
  subRequests,
  writeLeagueSettings,
} from "@injurysub/db";
import { createEspnReadClient, type ScenarioName } from "@injurysub/espn";
import { cutConnectionAt } from "@injurysub/test-db";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import { createWebDatabaseConnection } from "../../lib/server/db";
import {
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "../../lib/server/test-support";
import { POST } from "./route";

// Team 1 in the scenarios, on day 8 of matchup 2 (days 7-13): Damian Lillard (6606) is the OUT
// guard; Jeremiah Fears (5144091) is a bench guard who can take his slot directly.
const LILLARD = 6606;
const TATUM = 4065648;
const FEARS = 5144091;
const appOrigin = "http://localhost:3000";

function scripted(scenario: ScenarioName, change?: TeamWeekChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario }), change);
}

const line = (fantasyPoints: number) => ({
  fantasyPoints,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
});

// A player's line on one day of the read, active or benched.
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

function withDesignation(playerId: number, status: "DAY_TO_DAY"): TeamWeekChange {
  return (read) => ({
    ...read,
    lineup: {
      ...read.lineup,
      starters: read.lineup.starters.map((slot) =>
        slot.player?.playerId === playerId
          ? { ...slot, player: { ...slot.player, designation: { status } } }
          : slot
      ),
    },
  });
}

// Lillard credited 20.5 on day 7; Fears 12.4 on the bench today before the request.
const scoredWeek: TeamWeekChange = (read) =>
  withLine(FEARS, 8, 12.4, false)(withLine(LILLARD, 7, 20.5, true)(read));

// A team-1 manager signed in, and an active commissioner to email.
async function signedInTeam1(db: DatabaseExecutor): Promise<string> {
  await insertInventedUser(db, { role: "commissioner" });
  const userId = await insertInventedUser(db, { teamId: 1 });
  return insertSession(db, userId, new Date());
}

function confirm(
  token: string | null,
  fields: Record<string, string>,
  origin: string = appOrigin
): Promise<Response> {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = {
    origin,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (token !== null) headers.cookie = `injurysub_session=${token}`;
  return POST(new NextRequest("http://0.0.0.0:8080/requests", { method: "POST", headers, body }));
}

function swap(idempotencyKey: string = randomUUID()) {
  return { injured: String(LILLARD), replacement: String(FEARS), idempotencyKey };
}

function locationOf(response: Response): URL {
  expect(response.status).toBe(303);
  return new URL(response.headers.get("location") ?? "");
}

// The request snapshot of the scored week: ESPN's day 8, with the projection's lines.
async function expectScoredWeekSnapshot(db: DatabaseExecutor): Promise<void> {
  const [snapshot] = await db.select().from(subRequestSnapshots);
  expect(snapshot).toMatchObject({ phase: "request", espnDay: 8 });
  expect(JSON.stringify(snapshot?.payload)).toContain('"fantasyPoints":12.4');
  expect(snapshot?.payload).toMatchObject({
    projection: {
      totalTenths: -329,
      lines: [
        { day: 7, playerId: LILLARD, tenths: -205, why: "injured_credited_before_swap" },
        { day: 8, playerId: FEARS, tenths: -124, why: "replacement_before_request" },
      ],
    },
  });
}

async function expectOneCommissionerEmail(
  db: DatabaseExecutor,
  requestId: string | undefined
): Promise<void> {
  const emails = await db.select().from(emailOutbox);
  expect(emails).toHaveLength(1);
  expect(emails[0]).toMatchObject({ dedupeKey: `${requestId}:0` });
  expect(emails[0]?.body).toContain("Jeremiah Fears in for Damian Lillard");
}

describe("POST /requests", () => {
  webDbTest(
    "records a valid direct swap for the commissioner while automation is off, and emails them",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter", scoredWeek);
      const token = await signedInTeam1(db);

      const response = await confirm(token, swap());

      const [request] = await db.select().from(subRequests);
      expect(locationOf(response).href).toBe(`${appOrigin}/app/requests/${request?.requestId}`);
      expect(request).toMatchObject({
        kind: "substitution",
        teamId: 1,
        season: 2027,
        matchupPeriodId: 2,
        injuredPlayerId: LILLARD,
        injuredSlot: "G",
        replacementPlayerId: FEARS,
        requestDay: 8,
        designationAtRequest: "OUT",
        status: "needs_review",
        reviewReason: "automation_off",
        executionModeAtRequest: "approval_required",
        replacementPointsAtRequestTenths: 124,
        snapshotSource: "observed",
        // -20.5 for Lillard's credited day 7, -12.4 for Fears's points before the request.
        projectedAdjustmentTenths: -329,
      });
      await expectScoredWeekSnapshot(db);
      expect(await db.select({ type: subRequestEvents.eventType }).from(subRequestEvents)).toEqual([
        { type: "request_filed" },
      ]);
      await expectOneCommissionerEmail(db, request?.requestId);
    }
  );

  webDbTest(
    "puts a request in approval-required mode before the commissioner, expiring 12 hours on",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const token = await signedInTeam1(db);
      const now = new Date();
      await writeLeagueSettings(db, {
        executionMode: "approval_required",
        writeAllowlist: [1],
        updatedBy: await insertInventedUser(db),
        now,
        shownUpdatedAt: null,
      });

      await confirm(token, swap());

      const [request] = await db.select().from(subRequests);
      expect(request).toMatchObject({ status: "awaiting_approval", reviewReason: null });
      const hours = (request!.expiresAt!.getTime() - request!.filedAt.getTime()) / 3_600_000;
      expect(hours).toBe(12);
      expect(await db.select().from(emailOutbox)).toHaveLength(1);
    }
  );

  webDbTest("queues a request in auto mode without emailing anyone", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const token = await signedInTeam1(db);
    await writeLeagueSettings(db, {
      executionMode: "auto",
      writeAllowlist: [1],
      updatedBy: await insertInventedUser(db),
      now: new Date(),
      shownUpdatedAt: null,
    });

    await confirm(token, swap());

    expect(await db.select().from(subRequests)).toMatchObject([
      { status: "queued", reviewReason: null },
    ]);
    expect(await db.select().from(emailOutbox)).toEqual([]);
  });

  webDbTest("records one request for five submissions of one Confirm", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const token = await signedInTeam1(db);
    const fields = swap();

    const responses = await Promise.all(Array.from({ length: 5 }, () => confirm(token, fields)));

    const rows = await db.select().from(subRequests);
    expect(rows).toHaveLength(1);
    for (const response of responses) {
      expect(locationOf(response).pathname).toBe(`/app/requests/${rows[0]?.requestId}`);
    }
  });

  webDbTest(
    "refuses, and records, a request whose starter is no longer OUT",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter", withDesignation(LILLARD, "DAY_TO_DAY"));
      const token = await signedInTeam1(db);

      const response = await confirm(token, swap());

      const location = locationOf(response);
      expect(location.pathname).toBe("/app");
      expect(location.searchParams.get("status")).toBe("not_out");
      expect(await db.select().from(subRequests)).toMatchObject([
        { status: "refused", refusalReason: "not_out", designationAtRequest: "DAY_TO_DAY" },
      ]);
      expect(await db.select().from(emailOutbox)).toEqual([]);
    }
  );

  webDbTest("refuses a player from another team, recording nothing", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const token = await signedInTeam1(db);

    const response = await confirm(token, { ...swap(), replacement: "3112335" });

    expect(locationOf(response).searchParams.get("status")).toBe("not_on_team");
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  webDbTest("refuses a Confirm sent from another site", async ({ database }) => {
    const { db } = database.connection;
    scripted("one-out-starter");
    const token = await signedInTeam1(db);

    const response = await confirm(token, swap(), "https://evil.example");

    expect(response.status).toBe(403);
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  webDbTest("sends a Confirm without a live session to sign in", async ({ database }) => {
    scripted("one-out-starter");

    const response = await confirm(`token-${randomUUID()}`, swap());

    expect(locationOf(response).pathname).toBe("/login");
    expect(locationOf(response).searchParams.get("redirect")).toBe("/app");
    expect(await database.connection.db.select().from(subRequests)).toEqual([]);
  });

  webDbTest("says it couldn't check ESPN when the worker doesn't answer", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("worker_unreachable");
    const token = await signedInTeam1(db);

    const response = await confirm(token, swap());

    const location = locationOf(response);
    expect(location.pathname).toBe("/app/requests/new");
    expect(location.searchParams.get("status")).toBe("espn_unreachable");
    expect(location.searchParams.get("injured")).toBe(String(LILLARD));
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  webDbTest(
    "asks to try again when the database is lost as the transaction opens, recording nothing",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const token = await signedInTeam1(db);
      const proxy = await cutConnectionAt(database.url, "begin");
      const cut = createWebDatabaseConnection(proxy.url);
      globalThis.__injurysubWebDb = cut;
      let response: Response;
      try {
        response = await confirm(token, swap());
      } finally {
        await cut.close();
        await proxy.close();
        globalThis.__injurysubWebDb = database.connection;
      }

      expect(locationOf(response).searchParams.get("status")).toBe("unavailable");
      expect(await db.select().from(subRequests)).toEqual([]);
    }
  );

  webDbTest(
    "records one request from two different Confirms for one starter, and the other's refusal",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("one-out-starter");
      const token = await signedInTeam1(db);

      const responses = await Promise.all([confirm(token, swap()), confirm(token, swap())]);

      const rows = await db.select().from(subRequests);
      const live = rows.filter((row) => row.status !== "refused");
      expect(live).toHaveLength(1);
      expect(rows.filter((row) => row.status === "refused")).toMatchObject([
        { refusalReason: "active_request_exists" },
      ]);
      const statuses = responses.map((response) => locationOf(response).searchParams.get("status"));
      expect(statuses.sort()).toEqual(["active_request_exists", null]);
    }
  );

  webDbTest(
    "refuses a replacement another request still in flight names, recording why (Dec-D30)",
    async ({ database }) => {
      const { db } = database.connection;
      scripted("two-out-starters");
      const token = await signedInTeam1(db);
      const tatums = await insertInventedRequest(db, {
        injuredPlayerId: TATUM,
        injuredName: "Jayson Tatum",
        injuredSlot: "F",
        status: "queued",
        reviewReason: null,
      });

      const response = await confirm(token, swap());

      expect(locationOf(response).searchParams.get("status")).toBe("replacement_in_flight");
      const lillards = (await db.select().from(subRequests)).find(
        (row) => row.injuredPlayerId === LILLARD
      );
      expect(lillards).toMatchObject({ status: "refused", refusalReason: "replacement_in_flight" });
      const refused = (await db.select().from(subRequestEvents)).find(
        (event) => event.requestId === lillards?.requestId
      );
      expect(refused).toMatchObject({
        eventType: "request_refused",
        payload: { refusal: { inFlightRequestId: tatums, starterName: "Jayson Tatum" } },
      });
    }
  );
});
