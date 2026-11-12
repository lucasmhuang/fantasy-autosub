import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  readLeagueSettings,
  subRequestEvents,
  subRequestSnapshots,
  subRequests,
} from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import {
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "../../../../../lib/server/test-support";
import { POST as confirm } from "../../../../requests/route";
import { POST as saveSettings } from "../../settings/save/route";
import { POST as complete } from "./complete/route";
import { POST as override } from "./override/route";
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

function form(path: string, token: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) body.append(name, each);
  }
  return new NextRequest(`http://0.0.0.0:8080${path}`, {
    method: "POST",
    headers: {
      origin: appOrigin,
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
      };
      const again = await confirm(form("/requests", manager.token, fields));
      expect(statusParam(again)).toBe("active_request_exists");
    }
  );

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

  webDbTest("refuses every action from a manager, changing nothing", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "manager", 1);
    const requestId = await insertInventedRequest(db, {
      status: "completed_manually",
      reviewReason: null,
    });

    for (const action of [reject, override, complete, reverse]) {
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

describe("the commissioner's settings", () => {
  webDbTest(
    "switches to auto, allows team 1, then turns automation off, each read back",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedIn(db, "commissioner", 1);
      const save = (fields: Record<string, string | string[]>) =>
        saveSettings(form("/commish/settings/save", token, fields));

      expect(statusParam(await save({ executionMode: "auto", team: ["1"] }))).toBe("saved");
      expect(await readLeagueSettings(db)).toMatchObject({
        executionMode: "auto",
        writeAllowlist: [1],
      });

      expect(statusParam(await save({ executionMode: "auto" }))).toBe("saved");
      expect(await readLeagueSettings(db)).toMatchObject({ writeAllowlist: [] });
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
