import { recordMisuseWatch, writeLeagueSettings } from "@injurysub/db";
import { describe, expect } from "vitest";
import { renderedMarkup } from "../../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  webDbTest,
} from "../../../../lib/server/test-support";
import CommissionerAlertsPage from "./page";

const open = (token: string | null) =>
  callPage(token, () => CommissionerAlertsPage({ searchParams: Promise.resolve({}) }));

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the alerts page's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fcommish%2Falerts" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});

// FS-TIME-1, FS-TIME-2: times in the zone this device reported, PT until it has.
describe("the alerts page's times", () => {
  webDbTest.for([
    ["America/New_York", "last at Thu 9:05 PM ET."],
    [null, "last at Thu 6:05 PM PT."],
  ] as const)(
    "for a device whose zone is %s, reads %j",
    async ([timeZone, expected], { database }) => {
      const { db } = database.connection;
      // The shell asks the worker for its bar; none answers here.
      setRefusingWebEspn("worker_unreachable");
      const checkedAt = new Date("2026-11-06T02:05:00.000Z");
      await recordMisuseWatch(db, { state: "working", code: null, checkedAt });
      const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
      const token = await insertSession(db, userId, new Date(), { timeZone });

      const markup = await renderedMarkup(await open(token));

      expect(markup).toContain(expected);
    }
  );
});

// FS-SHELL-7, Revision 4 A and C: the automation line under the title, its switch answering here.
describe("the alerts page's automation line", () => {
  webDbTest("draws the line, its switch posting this page", async ({ database }) => {
    const { db } = database.connection;
    // The shell asks the worker for its bar; none answers here.
    setRefusingWebEspn("worker_unreachable");
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
    expect(markup).toContain(`<input type="hidden" name="from" value="/commish/alerts"/>`);
    expect(markup.replaceAll("<!-- -->", "")).toContain("Automation on");
  });
});
