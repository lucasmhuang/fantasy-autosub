import { describe, expect } from "vitest";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  webDbTest,
} from "../../../../../lib/server/test-support";
import ConfirmRequestPage from "./page";

// ESPN refuses every read, so a page that got past its guard renders its unavailable state
// rather than reaching for the network.
function open(token: string | null) {
  setRefusingWebEspn("not_connected");
  return callPage(token, () =>
    ConfirmRequestPage({
      searchParams: Promise.resolve({ injured: "6606", replacement: "5144091" }),
    })
  );
}

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the Confirm page's guard", () => {
  // KF1, IF-SIGNIN-4: back to this Confirm, the same two players, after the code.
  webDbTest(
    "sends a browser without a session to sign in, coming back to this Confirm",
    async () => {
      expect(await open(null)).toEqual({
        redirect: `/login?redirect=${encodeURIComponent("/app/requests/new?injured=6606&replacement=5144091")}`,
      });
    }
  );

  webDbTest.for([["manager"], ["commissioner"]] as const)(
    "sends a %s without a team to the team page",
    async ([role], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role });

      expect(await open(await insertSession(db, userId, new Date()))).toEqual({
        redirect: "/app",
      });
    }
  );
});
