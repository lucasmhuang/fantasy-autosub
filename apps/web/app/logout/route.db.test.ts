import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import {
  insertInventedUser,
  insertSession,
  readSession,
  webDbTest,
} from "../../lib/server/test-support";
import { POST } from "./route";

// Behind the host's proxy, the request's own URL is the server's internal address, not the
// app's (APP_BASE_URL, http://localhost:3000 in tests).
function signOut(headers: Record<string, string>) {
  return POST(new NextRequest("http://0.0.0.0:8080/logout", { method: "POST", headers }));
}

describe("POST /logout", () => {
  webDbTest(
    "signs out only this browser, and sends it to the login page on the app's own address",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db);
      const thisBrowser = await insertSession(db, userId, new Date());
      const otherBrowser = await insertSession(db, userId, new Date());

      const response = await signOut({
        origin: "http://localhost:3000",
        cookie: `injurysub_session=${thisBrowser}`,
      });

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/login?status=signed_out"
      );
      const cleared = response.headers.get("set-cookie") ?? "";
      expect(cleared).toContain("injurysub_session=;");
      expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      expect(cleared).toContain("HttpOnly");
      expect(cleared).toMatch(/SameSite=lax/i);
      expect(cleared).toContain("Path=/");
      expect((await readSession(db, thisBrowser))?.revokedAt).not.toBeNull();
      expect((await readSession(db, otherBrowser))?.revokedAt).toBeNull();
    }
  );

  webDbTest.for([["https://evil.example"], [null]] as const)(
    "refuses a sign-out sent with Origin %s, signing nobody out",
    async ([origin], { database, webLog }) => {
      const { db } = database.connection;
      const token = await insertSession(db, await insertInventedUser(db), new Date());

      const response = await signOut({
        ...(origin === null ? {} : { origin }),
        cookie: `injurysub_session=${token}`,
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("This form must be sent from InjurySub.");
      expect((await readSession(db, token))?.revokedAt).toBeNull();
      expect(webLog.events()).toMatchObject([
        { event: "web.auth.cross_site_refused", path: "/logout" },
      ]);
    }
  );
});
