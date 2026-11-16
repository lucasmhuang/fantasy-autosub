import { randomUUID } from "node:crypto";
import { type DatabaseExecutor, subRequests } from "@injurysub/db";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import { liveStatusSchema } from "../../../../components/board/live-request-state";
import { createWebDatabaseConnection } from "../../../../lib/server/db";
import {
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  webDbTest,
} from "../../../../lib/server/test-support";
import { GET } from "./route";

// The request page's poll. A null token sends no cookie.
function poll(requestId: string, token: string | null) {
  return GET(
    new NextRequest(`http://0.0.0.0:8080/requests/${requestId}/status`, {
      headers: token === null ? {} : { cookie: `injurysub_session=${token}` },
    }),
    { params: Promise.resolve({ id: requestId }) }
  );
}

async function signedIn(
  db: DatabaseExecutor,
  options: { teamId: number | null; role?: "manager" | "commissioner" }
) {
  const userId = await insertInventedUser(db, options);
  return { userId, token: await insertSession(db, userId, new Date()) };
}

describe("GET /requests/:id/status", () => {
  webDbTest(
    "answers the team's own request with its status fields, uncached and setting no cookie",
    async ({ database }) => {
      const { db } = database.connection;
      const { userId, token } = await signedIn(db, { teamId: 1 });
      const requestId = await insertInventedRequest(db, {
        requestedBy: userId,
        status: "queued",
        reviewReason: null,
        projectedAdjustmentTenths: -126,
      });

      const response = await poll(requestId, token);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      const body = await response.json();
      // The client reads it through the same schema, so the shape that crosses is pinned here.
      expect(liveStatusSchema.parse(body)).toEqual(body);
      expect(body).toEqual({
        requestId,
        status: "queued",
        reviewReason: null,
        delayed: false,
        notStarted: true,
        adjustmentNotSent: false,
        adjustmentTenths: -126,
        adjustmentIsFinal: false,
        ahead: null,
        alertEmail: "unknown",
        canWithdraw: true,
        sentEditDiffers: false,
        tracker: {
          checkedAt: null,
          lineupSentAt: null,
          lineupVerifiedAt: null,
          adjustmentSentAt: null,
          adjustmentVerifiedAt: null,
          completedAt: null,
        },
        rehearsal: false,
        events: 1,
      });
    }
  );

  webDbTest("answers a change as soon as the request changes", async ({ database }) => {
    const { db } = database.connection;
    const { userId, token } = await signedIn(db, { teamId: 1 });
    const requestId = await insertInventedRequest(db, { requestedBy: userId, status: "queued" });
    await db.update(subRequests).set({ status: "executing" });

    const body = await (await poll(requestId, token)).json();

    expect(body.status).toBe("executing");
  });

  webDbTest("answers 404 for another team's request", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, { teamId: 2 });
    const requestId = await insertInventedRequest(db, { status: "queued" });

    const response = await poll(requestId, token);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  webDbTest("answers 404 for an id that isn't a request", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, { teamId: 1 });

    expect((await poll(randomUUID(), token)).status).toBe(404);
    expect((await poll("not-an-id", token)).status).toBe(404);
  });

  webDbTest("answers 404 to a manager without a team", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, { teamId: null });
    const requestId = await insertInventedRequest(db, { status: "queued" });

    expect((await poll(requestId, token)).status).toBe(404);
  });

  webDbTest("answers 401 when signed out", async ({ database }) => {
    const { db } = database.connection;
    const requestId = await insertInventedRequest(db, { status: "queued" });

    expect((await poll(requestId, null)).status).toBe(401);
    expect((await poll(requestId, "token-that-was-never-issued")).status).toBe(401);
  });

  webDbTest("answers the commissioner for any team's request", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, { teamId: 5, role: "commissioner" });
    const requestId = await insertInventedRequest(db, { status: "awaiting_approval" });

    const response = await poll(requestId, token);

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("awaiting_approval");
  });

  webDbTest("answers 503 when the database can't be reached", async ({ webLog }) => {
    globalThis.__injurysubWebDb = createWebDatabaseConnection(
      `postgres://postgres:postgres@${process.env.PGHOST}:1/injurysub`
    );

    const response = await poll(randomUUID(), "token-for-a-dead-database");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(webLog.events()).toContainEqual(
      expect.objectContaining({ event: "web.requests.status_unread", reason: "ECONNREFUSED" })
    );
  });
});
