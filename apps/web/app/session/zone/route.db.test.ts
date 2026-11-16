import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import { createWebDatabaseConnection } from "../../../lib/server/db";
import {
  insertInventedUser,
  insertSession,
  readSession,
  webDbTest,
} from "../../../lib/server/test-support";
import { POST } from "./route";

const appOrigin = "http://localhost:3000";

// The zone reporter's post. A null origin sends no Origin header; a null token, no cookie.
function report(zone: string, token: string | null, origin: string | null = appOrigin) {
  return POST(
    new NextRequest("http://0.0.0.0:8080/session/zone", {
      method: "POST",
      headers: {
        ...(origin === null ? {} : { origin }),
        ...(token === null ? {} : { cookie: `injurysub_session=${token}` }),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ zone }),
    })
  );
}

describe("POST /session/zone", () => {
  webDbTest(
    "keeps the device's zone on the session that sent it, and sets no cookie",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db);
      const thisDevice = await insertSession(db, userId, new Date());
      const otherDevice = await insertSession(db, userId, new Date());

      const response = await report("america/new_york", thisDevice);

      expect(response.status).toBe(204);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect((await readSession(db, thisDevice))?.timeZone).toBe("America/New_York");
      expect((await readSession(db, otherDevice))?.timeZone).toBeNull();
    }
  );

  webDbTest.for([["https://elsewhere.example"], [null]] as const)(
    "refuses a report sent with Origin %s, keeping nothing",
    async ([origin], { database, webLog }) => {
      const { db } = database.connection;
      const token = await insertSession(db, await insertInventedUser(db), new Date());

      const response = await report("America/New_York", token, origin);

      expect(response.status).toBe(403);
      expect((await readSession(db, token))?.timeZone).toBeNull();
      expect(webLog.events()).toMatchObject([
        { event: "web.auth.cross_site_refused", path: "/session/zone" },
      ]);
    }
  );

  webDbTest.for([[""], ["Not/A_Zone"]] as const)(
    "refuses %j as a zone, keeping the one it had",
    async ([zone], { database }) => {
      const { db } = database.connection;
      const token = await insertSession(db, await insertInventedUser(db), new Date(), {
        timeZone: "America/Chicago",
      });

      const response = await report(zone, token);

      expect(response.status).toBe(400);
      expect((await readSession(db, token))?.timeZone).toBe("America/Chicago");
    }
  );

  webDbTest("refuses a report from a browser that isn't signed in", async ({ database }) => {
    const { db } = database.connection;
    const signedOut = await insertSession(db, await insertInventedUser(db), new Date(), {
      revokedAt: new Date(),
    });

    expect((await report("America/New_York", null)).status).toBe(401);
    expect((await report("America/New_York", signedOut)).status).toBe(401);
    expect((await readSession(db, signedOut))?.timeZone).toBeNull();
  });

  // RS-APP-2: a database it can't reach answers 503 and logs the failure's code, never the query.
  webDbTest(
    "answers 503 when the database can't be reached, saving nothing",
    async ({ webLog }) => {
      globalThis.__injurysubWebDb = createWebDatabaseConnection(
        `postgres://postgres:postgres@${process.env.PGHOST}:1/injurysub`
      );

      const response = await report("America/New_York", "token-for-a-dead-database");

      expect(response.status).toBe(503);
      expect(webLog.events()).toContainEqual(
        expect.objectContaining({ event: "web.session.zone_unsaved", reason: "ECONNREFUSED" })
      );
    }
  );
});
