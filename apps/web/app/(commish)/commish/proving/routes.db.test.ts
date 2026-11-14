import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  emailOutbox,
  listTeamRequests,
  type NewSubRequest,
  readLeagueSettings,
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
  webDbTest,
} from "../../../../lib/server/test-support";
import { POST as approve } from "../requests/[id]/approve/route";
import { POST as complete } from "../requests/[id]/complete/route";
import { POST as override } from "../requests/[id]/override/route";
import { POST as reapprove } from "../requests/[id]/reapprove/route";
import { POST as reverse } from "../requests/[id]/reverse/route";
import { POST as cancel } from "./cancel/route";
import { POST as markDone } from "./done/route";
import { POST as file } from "./file/route";

const appOrigin = "http://localhost:3000";
// Team 1 in the recordings (day 8 of matchup 2): Karl-Anthony Towns at C, not OUT, and Day'Ron
// Sharpe on the bench, who takes his C in a direct swap.
const TOWNS = 3136195;
const SHARPE = 4432194;
const townsForSharpe = {
  injured: String(TOWNS),
  replacement: String(SHARPE),
  edit: `${TOWNS}:C>BE,${SHARPE}:BE>C`,
  period: "2",
};

function post(path: string, token: string, fields: Record<string, string>, origin = appOrigin) {
  return new NextRequest(`http://0.0.0.0:8080${path}`, {
    method: "POST",
    headers: {
      origin,
      cookie: `injurysub_session=${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  });
}

function act(
  action: typeof approve,
  requestId: string,
  token: string,
  fields: Record<string, string>
) {
  return action(post(`/commish/requests/${requestId}/x`, token, fields), {
    params: Promise.resolve({ id: requestId }),
  });
}

function location(response: Response): URL {
  expect(response.status).toBe(303);
  return new URL(response.headers.get("location") ?? "");
}

// The commissioner on team 1, signed in, with approval required and team 1 automated.
async function asCommissioner(db: DatabaseExecutor) {
  const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
  await writeLeagueSettings(db, {
    executionMode: "approval_required",
    writeAllowlist: [1],
    updatedBy: userId,
    now: new Date(),
    shownUpdatedAt: null,
  });
  setWebEspn(createEspnReadClient({ mode: "stub" }));
  return { userId, token: await insertSession(db, userId, new Date()) };
}

function fileProving(token: string, fields: Partial<typeof townsForSharpe> = {}) {
  const body = { ...townsForSharpe, idempotencyKey: randomUUID(), ...fields };
  return file(post("/commish/proving/file", token, body));
}

// A proving request on team 1 as the worker or the commissioner left it.
function insertProving(db: DatabaseExecutor, overrides: Partial<NewSubRequest>) {
  return insertInventedRequest(db, {
    kind: "proving",
    designationAtRequest: "ACTIVE",
    projectedAdjustmentTenths: null,
    ...overrides,
  });
}

async function requestRow(db: DatabaseExecutor, requestId: string) {
  return (await db.select().from(subRequests)).find((row) => row.requestId === requestId);
}

describe("filing a proving request", () => {
  webDbTest(
    "records a starter who isn't OUT as proving, waiting for approval, with no amount and no email",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await asCommissioner(db);

      const response = await fileProving(token);

      expect(location(response).pathname).toBe("/commish/proving");
      expect(location(response).searchParams.get("status")).toBe("proving_filed");
      expect(await db.select().from(subRequests)).toMatchObject([
        {
          kind: "proving",
          teamId: 1,
          status: "awaiting_approval",
          injuredPlayerId: TOWNS,
          projectedAdjustmentTenths: null,
        },
      ]);
      expect(await db.select().from(emailOutbox)).toEqual([]);
      expect(await listTeamRequests(db, 1)).toEqual([]);
    }
  );

  webDbTest("refuses a manager's filing, recording nothing", async ({ database }) => {
    const { db } = database.connection;
    await asCommissioner(db);
    // Team 1 has the commissioner; one active account per team.
    const managerId = await insertInventedUser(db, { teamId: 2 });

    const response = await fileProving(await insertSession(db, managerId, new Date()));

    expect(response.status).toBe(403);
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  webDbTest("refuses a filing once proving is marked done", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);
    await markDone(post("/commish/proving/done", token, {}));

    const response = await fileProving(token);

    expect(location(response).searchParams.get("status")).toBe("proving_done");
    expect(await db.select().from(subRequests)).toMatchObject([
      { kind: "proving", status: "refused", refusalReason: "proving_done" },
    ]);
  });

  webDbTest(
    "records nothing when ESPN's edit or matchup period moved since the page showed them",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await asCommissioner(db);

      const edited = await fileProving(token, { edit: `${TOWNS}:C>BE,${SHARPE}:BE>UTIL` });
      const moved = await fileProving(token, { period: "1" });

      expect(location(edited).searchParams.get("status")).toBe("edit_changed");
      expect(location(moved).searchParams.get("status")).toBe("week_changed");
      expect(await db.select().from(subRequests)).toEqual([]);
    }
  );

  webDbTest("marks proving done once, with the date", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);

    const response = await markDone(post("/commish/proving/done", token, {}));

    expect(location(response).searchParams.get("status")).toBe("proving_marked_done");
    expect((await readLeagueSettings(db)).provingDoneAt).toBeInstanceOf(Date);
  });
});

describe("the commissioner's actions on a proving request", () => {
  webDbTest(
    "approves the test amount, and refuses a page that showed another",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await asCommissioner(db);
      const shown = await insertProving(db, { status: "awaiting_approval", reviewReason: null });
      const stale = await insertProving(db, {
        status: "awaiting_approval",
        reviewReason: null,
        injuredPlayerId: 3,
      });

      const approved = await act(approve, shown, token, { version: "0", shownTenths: "1" });
      const refused = await act(approve, stale, token, { version: "0", shownTenths: "-404" });

      expect(location(approved).searchParams.get("status")).toBe("approved");
      expect(await requestRow(db, shown)).toMatchObject({
        status: "queued",
        approvedComputedTenths: 1,
      });
      expect(location(refused).searchParams.get("status")).toBe("amount_changed");
    }
  );

  webDbTest("refuses an override, a re-approval and a reversal", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);
    const held = await insertProving(db, { reviewReason: "adjustment_changed" });
    const done = await insertProving(db, { status: "completed", injuredPlayerId: 3 });

    const statuses = [
      await act(override, held, token, { version: "0", amount: "1.0" }),
      await act(reapprove, held, token, { version: "0" }),
      await act(reverse, done, token, { version: "0" }),
    ].map((response) => location(response).searchParams.get("status"));

    expect(statuses).toEqual(["not_allowed", "not_allowed", "not_allowed"]);
  });

  webDbTest(
    "closes a stopped run as put back by hand, with no amount, while ESPN can't be read",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await asCommissioner(db);
      const requestId = await insertProving(db, {
        reviewReason: "ambiguous",
        lineupState: "verified",
        effectiveDay: 8,
      });
      setRefusingWebEspn("espn_unavailable");

      const response = await act(complete, requestId, token, { version: "0" });

      expect(location(response).searchParams.get("status")).toBe("completed_manually");
      expect(await requestRow(db, requestId)).toMatchObject({
        status: "completed_manually",
        finalAdjustmentTenths: 0,
        lineupState: "pending",
        effectiveDay: null,
      });
    }
  );

  webDbTest("won't close a run with nothing on ESPN as put back by hand", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);
    const requestId = await insertProving(db, { reviewReason: "stale", lineupState: "pending" });

    const response = await act(complete, requestId, token, { version: "0" });

    expect(location(response).searchParams.get("status")).toBe("not_allowed");
    expect((await requestRow(db, requestId))?.status).toBe("needs_review");
  });
});

describe("cancelling a proving request", () => {
  function cancelOf(token: string, requestId: string) {
    return cancel(post("/commish/proving/cancel", token, { request: requestId, version: "0" }));
  }

  webDbTest("withdraws one waiting for approval, and one already queued", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);
    const waiting = await insertProving(db, { status: "awaiting_approval", reviewReason: null });
    const queued = await insertProving(db, {
      status: "queued",
      reviewReason: null,
      injuredPlayerId: 3,
    });

    const statuses = [await cancelOf(token, waiting), await cancelOf(token, queued)].map(
      (response) => location(response).searchParams.get("status")
    );

    expect(statuses).toEqual(["cancelled", "cancelled"]);
    expect((await requestRow(db, waiting))?.status).toBe("withdrawn");
    expect((await requestRow(db, queued))?.status).toBe("withdrawn");
  });

  webDbTest(
    "rejects one whose swap ESPN refused, and refuses one whose swap is on ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await asCommissioner(db);
      const refused = await insertProving(db, {
        reviewReason: "lineup_failed",
        lineupState: "failed",
      });
      const swapped = await insertProving(db, {
        reviewReason: "ambiguous",
        lineupState: "verified",
        injuredPlayerId: 3,
      });

      const statuses = [await cancelOf(token, refused), await cancelOf(token, swapped)].map(
        (response) => location(response).searchParams.get("status")
      );

      expect(statuses).toEqual(["cancelled", "not_allowed"]);
      expect((await requestRow(db, refused))?.status).toBe("rejected");
      expect((await requestRow(db, swapped))?.status).toBe("needs_review");
    }
  );

  webDbTest("cancels only a proving request", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);
    const real = await insertInventedRequest(db, {
      status: "awaiting_approval",
      reviewReason: null,
    });

    expect(location(await cancelOf(token, real)).searchParams.get("status")).toBe("not_found");
    expect((await requestRow(db, real))?.status).toBe("awaiting_approval");
  });
});

describe("every proving POST", () => {
  const posts: [string, (request: NextRequest) => Promise<Response>][] = [
    ["file", (request) => file(request)],
    ["done", (request) => markDone(request)],
    ["cancel", (request) => cancel(request)],
  ];

  webDbTest("refuses each one sent from another site, changing nothing", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await asCommissioner(db);
    const requestId = await insertProving(db, { status: "awaiting_approval", reviewReason: null });
    const fields = {
      ...townsForSharpe,
      idempotencyKey: randomUUID(),
      request: requestId,
      version: "0",
    };

    const statuses: number[] = [];
    for (const [, send] of posts) {
      statuses.push((await send(post("/commish/x", token, fields, "https://evil.example"))).status);
    }

    expect(statuses).toEqual([403, 403, 403]);
    expect(await db.select().from(subRequests)).toMatchObject([
      { status: "awaiting_approval", version: 0 },
    ]);
    expect((await readLeagueSettings(db)).provingDoneAt).toBeNull();
  });

  webDbTest("sends each one without a live session to sign in", async ({ database }) => {
    const { db } = database.connection;
    await asCommissioner(db);

    const paths: string[] = [];
    for (const [, send] of posts) {
      paths.push(location(await send(post("/commish/x", `token-${randomUUID()}`, {}))).pathname);
    }

    expect(paths).toEqual(["/login", "/login", "/login"]);
    expect((await readLeagueSettings(db)).provingDoneAt).toBeNull();
  });
});
