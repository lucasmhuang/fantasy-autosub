import { writeLeagueSettings } from "@injurysub/db";
import { describe, expect } from "vitest";
import { renderedMarkup } from "../../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  webDbTest,
} from "../../../../lib/server/test-support";
import ProvingRequestsPage from "./page";

// ESPN refuses every read, so a page that got past its guard renders its unavailable state
// rather than reaching for the network.
function open(token: string | null) {
  setRefusingWebEspn("not_connected");
  return callPage(token, () => ProvingRequestsPage({ searchParams: Promise.resolve({}) }));
}

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the proving page's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fcommish%2Fproving" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});

// FS-SHELL-7, Revision 4 A and C: the automation line under the title, its switch answering here.
describe("the proving page's automation line", () => {
  webDbTest("draws the line, its switch posting this page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
    await writeLeagueSettings(db, {
      executionMode: "approval_required",
      writeAllowlist: [1, 4],
      updatedBy: userId,
      now: new Date(),
      shownUpdatedAt: null,
    });
    const token = await insertSession(db, userId, new Date());
    const markup = await renderedMarkup(await open(token));

    expect(markup.match(/class="autostrip/g)).toHaveLength(1);
    expect(markup).toContain(`<input type="hidden" name="from" value="/commish/proving"/>`);
    expect(markup.replaceAll("<!-- -->", "")).toContain("Automation on");
  });
});
