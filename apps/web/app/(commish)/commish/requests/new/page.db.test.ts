import { recordTeamNames } from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { cutConnectionAt } from "@injurysub/test-db";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import { formsIn, renderedMarkup } from "../../../../../components/test-support";
import { createWebDatabaseConnection } from "../../../../../lib/server/db";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "../../../../../lib/server/test-support";
import CommissionerRequestPage from "../[id]/page";
import { POST } from "../file/route";
import FileRequestPage from "./page";

const open = (token: string | null, searchParams: { team?: string; status?: string } = {}) =>
  callPage(token, () => FileRequestPage({ searchParams: Promise.resolve(searchParams) }));

function scripted(change?: TeamWeekChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }), change);
}

// React separates adjacent text with comments; the reader sees one line.
async function pageText(page: Awaited<ReturnType<typeof open>>): Promise<string> {
  return (await renderedMarkup(page)).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
}

async function commissionerToken(
  db: Parameters<typeof insertInventedUser>[0],
  timeZone: string | null = null
): Promise<string> {
  const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
  return insertSession(db, userId, new Date(), { timeZone });
}

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the filing form's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fcommish%2Frequests%2Fnew" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});

// FS-FILE-1: every team but the commissioner's own, by its name and its manager's first name.
describe("the filing form's team picker", () => {
  webDbTest.for([[{}], [{ team: "1" }]] as const)(
    "offers every team but the commissioner's own, with %o",
    async ([searchParams], { database }) => {
      const { db } = database.connection;
      setRefusingWebEspn("worker_unreachable");
      await recordTeamNames(db, { teams: [{ teamId: 2, name: "Glass Cannons" }], now: new Date() });
      await insertInventedUser(db, { teamId: 2 });

      const page = await open(await commissionerToken(db), searchParams);
      const markup = await renderedMarkup(page);

      const pickers = formsIn(markup).filter((form) => form.method === "get");
      expect(pickers).toEqual([
        {
          action: "/commish/requests/new",
          method: "get",
          fields: [
            expect.objectContaining({
              tag: "select",
              name: "team",
              options: ",2,3,4,5,6,7,8,9,10,11,12",
            }),
          ],
        },
      ]);
      const text = await pageText(page);
      expect(text).toContain("Glass Cannons · Invented");
      expect(text).toContain("Team 3");
      expect(text).toContain("File your own from your Team page.");
      expect(formsIn(markup).map((form) => form.action)).not.toContain("/commish/requests/file");
    }
  );
});

// FS-FILE-2 to -6: the team's form, field names being the route's contract (RS-FILE-1). The
// points and the note join only once In progress is chosen (filing-state's showsPoints).
describe("the filing form for a team", () => {
  webDbTest("asks every answer the route reads, and says the week", async ({ database }) => {
    const { db } = database.connection;
    scripted();

    const page = await open(await commissionerToken(db), { team: "2" });
    const markup = await renderedMarkup(page);

    const [form] = formsIn(markup).filter((each) => each.action === "/commish/requests/file");
    expect([...new Set(form?.fields.map((field) => field.name))].sort()).toEqual(
      [
        "day",
        "designation",
        "idempotencyKey",
        "injured",
        "replacement",
        "replacementGame",
        "team",
        "time",
        "zone",
      ].sort()
    );
    const text = await pageText(page);
    expect(text).toContain("File for a manager");
    expect(text).toMatch(/Week \d+, vs /);
    expect(text).toContain("Injured starter");
    expect(text).toContain("Replacement from the bench");
    expect(text).toContain("File request");
  });

  // FS-TIME-6: the form names the zone it reads the typed time in, the device's, and posts it.
  webDbTest.for([
    ["America/New_York", "Time, ET"],
    [null, "Time, PT"],
  ] as const)(
    "for a device whose zone is %s, labels the time %s and posts that zone",
    async ([timeZone, label], { database }) => {
      const { db } = database.connection;
      scripted();

      const page = await open(await commissionerToken(db, timeZone), { team: "2" });

      const [form] = formsIn(await renderedMarkup(page)).filter(
        (each) => each.action === "/commish/requests/file"
      );
      expect(form?.fields).toContainEqual({
        tag: "input",
        type: "hidden",
        name: "zone",
        value: timeZone ?? "America/Los_Angeles",
      });
      expect(await pageText(page)).toContain(label);
    }
  );

  webDbTest("says a team with no matchup has a bye (FM-FILE-1)", async ({ database }) => {
    const { db } = database.connection;
    scripted((read) => ({ ...read, matchup: null }));

    const page = await open(await commissionerToken(db), { team: "2" });

    expect(await pageText(page)).toContain(
      "has a bye this week, so there's nothing to file against."
    );
    expect(formsIn(await renderedMarkup(page)).map((form) => form.action)).not.toContain(
      "/commish/requests/file"
    );
  });

  webDbTest("says ESPN can't be read, with Try again (FM-FILE-2)", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("espn_unavailable");

    const page = await open(await commissionerToken(db), { team: "2" });

    const text = await pageText(page);
    expect(text).toContain("Can't read ESPN right now, so Team 2's lineup can't be shown.");
    expect(text).toContain("Try again");
  });

  webDbTest("gives the plain post's answer as its sentence", async ({ database }) => {
    const { db } = database.connection;
    scripted();

    const page = await open(await commissionerToken(db), {
      team: "2",
      status: "moment_outside_matchup",
    });

    expect(await pageText(page)).toContain("Not filed: that moment isn't in this matchup week.");
  });

  webDbTest(
    "shows the database-down page when the team names can't be read",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const token = await commissionerToken(db);
      const proxy = await cutConnectionAt(database.url, 'from "teams"');
      const cut = createWebDatabaseConnection(proxy.url);
      globalThis.__injurysubWebDb = cut;
      let text: string;
      try {
        text = await pageText(await open(token, { team: "2" }));
      } finally {
        await cut.close();
        await proxy.close();
        globalThis.__injurysubWebDb = database.connection;
      }

      expect(text).toContain("Can't load InjurySub right now");
    }
  );
});

// IF-FILE-3: a filing reads as the commissioner's, for the team's manager, on its detail.
describe("a request filed for a manager", () => {
  webDbTest("reads as filed by you for the manager on its detail", async ({ database }) => {
    const { db } = database.connection;
    scripted();
    const commissioner = await insertInventedUser(db, { role: "commissioner" });
    await insertInventedUser(db, { teamId: 1 });
    const now = new Date();
    const token = await insertSession(db, commissioner, now);
    const body = new URLSearchParams({
      team: "1",
      injured: "6606",
      replacement: "5144091",
      day: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now),
      time: "00:00",
      designation: "OUT",
      replacementGame: "not_started",
      idempotencyKey: crypto.randomUUID(),
      zone: "America/Los_Angeles",
    });
    const filed = await POST(
      new NextRequest("http://0.0.0.0:8080/commish/requests/file", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: `injurysub_session=${token}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      })
    );
    const answer: { location: string } = await filed.json();

    const page = await callPage(token, () =>
      CommissionerRequestPage({
        params: Promise.resolve({ id: answer.location.split("/").at(-1) ?? "" }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(await pageText(page)).toContain("Filed by you for Invented");
  });
});
