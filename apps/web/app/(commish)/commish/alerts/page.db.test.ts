import { randomUUID } from "node:crypto";
import {
  acknowledgeMisuseAlert,
  type DatabaseExecutor,
  recordMisuseAlert,
  recordMisuseWatch,
  writeLeagueSettings,
} from "@injurysub/db";
import { cutConnectionAt } from "@injurysub/test-db";
import { describe, expect } from "vitest";
import { formsIn, renderedMarkup } from "../../../../components/test-support";
import { createWebDatabaseConnection } from "../../../../lib/server/db";
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
    ["America/New_York", "Watching ESPN · checked Thu Nov 5, 9:05 PM ET"],
    [null, "Watching ESPN · checked Thu Nov 5, 6:05 PM PT"],
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

      expect(markup.replace(/<[^>]*>/g, "")).toContain(expected);
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

async function commissioner(db: DatabaseExecutor) {
  setRefusingWebEspn("worker_unreachable");
  const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
  return { userId, token: await insertSession(db, userId, new Date()) };
}

async function pageOf(token: string) {
  const markup = await renderedMarkup(await open(token));
  return { markup, text: markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'") };
}

function alertFor(overrides: Record<string, unknown> = {}) {
  return {
    alertId: randomUUID(),
    espnRef: `transaction:${randomUUID()}`,
    kind: "lm_transaction" as const,
    teamId: 4,
    teamName: "Backdoor Cutters",
    espnAt: new Date("2026-11-15T23:12:00.000Z"),
    details: {
      what: "A league-manager edit InjurySub didn't make.",
      undo: ["As league manager, move Mathurin F → BN and Siakam BN → F."],
    },
    players: [{ playerId: 3149673, name: "Pascal Siakam" }],
    foundAt: new Date("2026-11-15T23:13:00.000Z"),
    ...overrides,
  };
}

// FS-ALERTS-1 to -6, FM-ALERTS-1, Revision 5.
describe("the misuse watch page", () => {
  webDbTest(
    "lists an open alert with its times, faces, undo and Acknowledge",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await commissioner(db);
      await recordMisuseWatch(db, { state: "working", code: null, checkedAt: new Date() });
      const { alert } = await recordMisuseAlert(db, alertFor());

      const { markup, text } = await pageOf(token);

      expect(text).toContain("Misuse watch");
      expect(text).toContain("Lineup change on Backdoor Cutters");
      expect(text).toMatch(/ESPN's time \w{3} .* · seen /);
      expect(text).toContain("A league-manager edit InjurySub didn't make.");
      expect(text).toContain("Pascal Siakam");
      expect(text).toContain("To undo: As league manager, move Mathurin F → BN and Siakam BN → F.");
      expect(formsIn(markup).map((form) => form.action)).toContain(
        `/commish/alerts/${alert.alertId}/acknowledge`
      );
      expect(text).toContain(
        "Removing InjurySub's copy of the ESPN cookie doesn't stop the cookie working."
      );
    }
  );

  webDbTest("says there are none, and lists the team's moves", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await commissioner(db);
    await recordMisuseWatch(db, {
      state: "working",
      code: null,
      checkedAt: new Date(),
      teamMoves: [
        {
          at: "2026-11-15T23:12:00.000Z",
          type: "ROSTER",
          byLeagueManager: false,
          items: [{ type: "LINEUP", player: "Stephen Curry", fromSlot: "G", toSlot: "BN" }],
        },
      ],
    });

    const { text } = await pageOf(token);

    expect(text).toContain("No alerts.");
    expect(text).not.toContain("Removing InjurySub's copy");
    expect(text).toContain("Your team's moves, past 24 hours");
    expect(text).toContain("Lineup: Curry G → BN");
    expect(text).toContain("These look the same as your own moves; check for any you didn't make.");
  });

  webDbTest("says detection is paused, and hides the team's moves", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await commissioner(db);
    await recordMisuseWatch(db, {
      state: "credentials_rejected",
      code: null,
      checkedAt: new Date(),
      teamMoves: [],
    });

    const { text } = await pageOf(token);

    expect(text).toMatch(/Paused since /);
    expect(text).toContain(
      "Detection is paused: ESPN refused the cookie, so nothing is being checked. You were emailed."
    );
    expect(text).not.toContain("Your team's moves");
  });

  webDbTest(
    "collapses the acknowledged, a matched one acknowledged automatically",
    async ({ database }) => {
      const { db } = database.connection;
      const { userId, token } = await commissioner(db);
      await recordMisuseWatch(db, { state: "working", code: null, checkedAt: new Date() });
      const { alert } = await recordMisuseAlert(db, alertFor());
      await acknowledgeMisuseAlert(db, { alertId: alert.alertId, userId, at: new Date() });
      await recordMisuseAlert(
        db,
        alertFor({
          acknowledgedAt: new Date(),
          acknowledgedNote:
            "Matches your by-hand completion of Eason in for Şengün, Thu 10:20 AM PT.",
        })
      );

      const { markup, text } = await pageOf(token);

      expect(markup).toContain("<details");
      expect(text).toContain("Acknowledged · 2");
      expect(text).toMatch(/Acknowledged (?:\w{3} )?\d{1,2}:\d{2} [AP]M/);
      expect(text).toContain(
        "Matches your by-hand completion of Eason in for Şengün, Thu 10:20 AM PT."
      );
      expect(text).toContain("Acknowledged automatically");
      expect(text).toContain("No alerts.");
    }
  );

  webDbTest("shows the database-down page when the alerts can't be read", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await commissioner(db);
    const proxy = await cutConnectionAt(database.url, 'from "misuse_alerts"');
    const cut = createWebDatabaseConnection(proxy.url);
    globalThis.__injurysubWebDb = cut;
    let text: string;
    try {
      text = (await pageOf(token)).text;
    } finally {
      await cut.close();
      await proxy.close();
      globalThis.__injurysubWebDb = database.connection;
    }

    expect(text).toContain("Can't load InjurySub right now");
    expect(text).not.toContain("Text your commissioner");
  });
});
