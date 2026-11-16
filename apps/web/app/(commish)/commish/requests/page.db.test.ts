import { describe, expect } from "vitest";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  webDbTest,
} from "../../../../lib/server/test-support";
import CommissionerRequestsPage from "./page";

// ESPN refuses every read, so a page that got past its guard renders its unavailable state
// rather than reaching for the network.
function open(token: string | null) {
  setRefusingWebEspn("not_connected");
  return callPage(token, () => CommissionerRequestsPage({ searchParams: Promise.resolve({}) }));
}

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the queue's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fcommish%2Frequests" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});
