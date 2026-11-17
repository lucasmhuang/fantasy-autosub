import { randomUUID } from "node:crypto";
import { recordMisuseAlert } from "@injurysub/db";
import { describe, expect } from "vitest";
import { renderedMarkup } from "../../../../components/test-support";
import {
  callPage,
  insertInventedRequest,
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

// FS-SHELL-2, IF-SHELL-4: the count the commissioner saw on Queue is what "Needs you" holds.
describe("the queue", () => {
  webDbTest(
    "counts the same requests and alerts in Queue and in Needs you",
    async ({ database }) => {
      const { db } = database.connection;
      await insertInventedRequest(db, { teamId: 2 });
      await insertInventedRequest(db, { teamId: 3, status: "completed", reviewReason: null });
      await recordMisuseAlert(db, {
        alertId: randomUUID(),
        espnRef: `transaction:${randomUUID()}`,
        kind: "lm_transaction",
        teamId: 4,
        teamName: null,
        espnAt: new Date(),
        details: { what: "invented", undo: [] },
        foundAt: new Date(),
      });
      const commissioner = await insertInventedUser(db, { role: "commissioner", teamId: 1 });

      const markup = await renderedMarkup(
        await open(await insertSession(db, commissioner, new Date()))
      );

      expect(markup).toContain("Needs you · 2");
      expect(markup).toContain('aria-label="Queue, 2 need you"');
      expect(markup).toContain("Everything else");
    }
  );
});
