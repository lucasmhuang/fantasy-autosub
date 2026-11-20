import { markProvingDone, writeLeagueSettings } from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { formsIn, renderedMarkup } from "../../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  setWebEspn,
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

// The proving page past its guard, ESPN read from the scripted league: team 1's Lillard (6606) is
// OUT, so the start form offers his bench options.
async function provingPage(db: Parameters<typeof insertInventedUser>[0], done = false) {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
  const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
  if (done) await markProvingDone(db, { updatedBy: userId, now: new Date() });
  const token = await insertSession(db, userId, new Date());
  const markup = await renderedMarkup(
    await callPage(token, () =>
      ProvingRequestsPage({ searchParams: Promise.resolve({ starter: "6606" }) })
    )
  );
  return { markup, text: markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'") };
}

// FS-PROVING-1 to -3, RS-PROVING-1: the warning and the start form, its fields the route's contract.
describe("the proving page's start form", () => {
  webDbTest("warns of the activity feed and files the first run", async ({ database }) => {
    const { markup, text } = await provingPage(database.connection.db);

    expect(text).toContain("Proving run");
    expect(text).toContain(
      "Tests every ESPN change InjurySub makes on your team, then puts it back."
    );
    expect(text).toContain(
      "The test adjustment and its revert post on the league’s ESPN activity feed, with the reason “InjurySub test (reverted)”. Everyone in the league can see them."
    );
    expect(text).toContain("Request 1 of 2: a direct swap");
    expect(text).not.toContain("the second run needs one that moves another starter");
    expect(text).not.toContain("Approve: InjurySub swaps the lineup");
    expect(text).toContain("File and run proving · +0.1 test");
    const [file] = formsIn(markup).filter((form) => form.action === "/commish/proving/file");
    expect([...new Set(file?.fields.map((field) => field.name))].sort()).toEqual(
      ["edit", "idempotencyKey", "injured", "period", "replacement"].sort()
    );
    const starters = formsIn(markup).filter((form) => form.method === "get");
    expect(starters[0]?.fields).toContainEqual(expect.objectContaining({ name: "starter" }));
  });

  webDbTest("refuses further runs once proving is done (FM-PROVING-2)", async ({ database }) => {
    const { markup, text } = await provingPage(database.connection.db, true);

    expect(text).toMatch(
      /Proving is done \(\w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M \w+\), so further proving runs are refused\./
    );
    expect(formsIn(markup).map((form) => form.action)).not.toContain("/commish/proving/file");
  });
});
