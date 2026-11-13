import { randomUUID } from "node:crypto";
import { type DatabaseExecutor, subRequestEvents, subRequests } from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import {
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setWebEspn,
  webDbTest,
} from "../../../../lib/server/test-support";
import { POST as confirm } from "../../route";
import { POST } from "./route";

const appOrigin = "http://localhost:3000";

async function signedInTeam1(db: DatabaseExecutor) {
  const userId = await insertInventedUser(db, { teamId: 1 });
  return { userId, token: await insertSession(db, userId, new Date()) };
}

function post(path: string, token: string, origin = appOrigin, body?: URLSearchParams) {
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

function withdraw(requestId: string, token: string, origin = appOrigin) {
  return POST(post(`/requests/${requestId}/withdraw`, token, origin), {
    params: Promise.resolve({ id: requestId }),
  });
}

function locationOf(response: Response): URL {
  expect(response.status).toBe(303);
  return new URL(response.headers.get("location") ?? "");
}

async function statusOf(db: DatabaseExecutor, requestId: string) {
  const rows = await db.select().from(subRequests);
  return rows.find((row) => row.requestId === requestId)?.status;
}

describe("POST /requests/:id/withdraw", () => {
  webDbTest(
    "withdraws a request nothing was written for, freeing its starter for a new one",
    async ({ database }) => {
      const { db } = database.connection;
      const { userId, token } = await signedInTeam1(db);
      const requestId = await insertInventedRequest(db, { requestedBy: userId });

      const response = await withdraw(requestId, token);

      const location = locationOf(response);
      expect(location.pathname).toBe(`/app/requests/${requestId}`);
      expect(location.searchParams.get("status")).toBe("withdrawn");
      expect(await statusOf(db, requestId)).toBe("withdrawn");
      const events = await db.select().from(subRequestEvents);
      expect(events.map((event) => event.eventType)).toContain("withdrawn");

      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const fields = {
        injured: "6606",
        replacement: "5144091",
        idempotencyKey: randomUUID(),
        edit: "6606:G>BE,5144091:BE>G",
        period: "2",
      };
      const again = await confirm(post("/requests", token, appOrigin, new URLSearchParams(fields)));
      expect(locationOf(again).searchParams.get("status")).toBeNull();
      expect((await db.select().from(subRequests)).map((row) => row.status).sort()).toEqual([
        "needs_review",
        "withdrawn",
      ]);
    }
  );

  webDbTest(
    "refuses to withdraw a completed request, or one whose lineup change went to ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedInTeam1(db);
      const completed = await insertInventedRequest(db, {
        status: "completed",
        reviewReason: null,
        lineupState: "verified",
      });
      const sent = await insertInventedRequest(db, {
        injuredPlayerId: 4065648,
        lineupState: "sent",
      });

      for (const requestId of [completed, sent]) {
        const location = locationOf(await withdraw(requestId, token));
        expect(location.searchParams.get("status")).toBe("cannot_withdraw");
      }
      expect(await statusOf(db, completed)).toBe("completed");
      expect(await statusOf(db, sent)).toBe("needs_review");
    }
  );

  webDbTest("doesn't find another team's request, changing nothing", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedInTeam1(db);
    const requestId = await insertInventedRequest(db, { teamId: 2 });

    const location = locationOf(await withdraw(requestId, token));

    expect(location.pathname).toBe("/app");
    expect(location.searchParams.get("status")).toBe("not_found");
    expect(await statusOf(db, requestId)).toBe("needs_review");
  });

  webDbTest("refuses a withdraw sent from another site", async ({ database }) => {
    const { db } = database.connection;
    const { userId, token } = await signedInTeam1(db);
    const requestId = await insertInventedRequest(db, { requestedBy: userId });

    const response = await withdraw(requestId, token, "https://evil.example");

    expect(response.status).toBe(403);
    expect(await statusOf(db, requestId)).toBe("needs_review");
  });
});
