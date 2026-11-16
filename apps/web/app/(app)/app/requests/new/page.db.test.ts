import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { linksIn, renderedMarkup, textOf } from "../../../../../components/test-support";
import { forgetLastReads } from "../../../../../lib/server/board";
import {
  callPage,
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  setWebEspn,
  webDbTest,
  withEligibleSlots,
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

// Choose: the address names the starter and no replacement yet.
async function choose(token: string, injured: string) {
  return renderedOrRedirect(
    await callPage(token, () => ConfirmRequestPage({ searchParams: Promise.resolve({ injured }) }))
  );
}

async function renderedOrRedirect(outcome: Awaited<ReturnType<typeof callPage>>) {
  if ("redirect" in outcome) return outcome;
  return {
    markup: (await renderedMarkup(outcome)).replaceAll("&#x27;", "'").replaceAll("<!-- -->", ""),
  };
}

async function managerOfTeam1(db: Parameters<typeof insertInventedUser>[0]) {
  return insertSession(db, await insertInventedUser(db, { teamId: 1 }), new Date());
}

describe("Choose", () => {
  webDbTest(
    "offers the OUT starter's bench, grouped by how each would go",
    async ({ database }) => {
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const token = await managerOfTeam1(database.connection.db);

      const result = await choose(token, "6606");
      const markup = "markup" in result ? result.markup : "";

      expect(markup).toContain("Replace Damian Lillard");
      expect(textOf(markup)).toContain("G slot · a swap forfeits");
      expect(markup).toMatch(/makes it · \d|Ready now · \d|decides · \d/);
      expect(linksIn(markup).map((link) => link.href)).toContain(
        "/app/requests/new?injured=6606&replacement=5144091"
      );
      expect(linksIn(markup)).toContainEqual(
        expect.objectContaining({ href: "/app", text: "Team" })
      );
    }
  );

  webDbTest(
    "keeps Not valid options behind a disclosure with their count",
    async ({ database }) => {
      setWebEspn(
        createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }),
        withEligibleSlots(4600663, ["BE", "IR"])
      );
      const token = await managerOfTeam1(database.connection.db);

      const result = await choose(token, "6606");
      const markup = "markup" in result ? result.markup : "";

      expect(markup).toMatch(/<details[^>]*>\s*<summary[^>]*>[\s\S]*Not valid[\s\S]*1/);
      expect(textOf(markup)).toContain("No legal lineup with him in it.");
    }
  );

  webDbTest("sends a starter who isn't OUT back to the team page", async ({ database }) => {
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const token = await managerOfTeam1(database.connection.db);

    expect(await choose(token, "4065648")).toEqual({ redirect: "/app?status=not_out" });
  });

  webDbTest("sends a starter with a request this week to it", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const token = await managerOfTeam1(db);
    const requestId = await insertInventedRequest(db);

    expect(await choose(token, "6606")).toEqual({ redirect: `/app/requests/${requestId}` });
  });

  webDbTest("says ESPN can't be reached, with the fallback and Try again", async ({ database }) => {
    forgetLastReads();
    setRefusingWebEspn("espn_unavailable");
    const token = await managerOfTeam1(database.connection.db);

    const result = await choose(token, "6606");
    const markup = "markup" in result ? result.markup : "";

    expect(textOf(markup)).toContain(
      "Can't reach ESPN right now, so your options can't be checked."
    );
    expect(linksIn(markup)).toContainEqual(
      expect.objectContaining({ href: "/app/requests/new?injured=6606", text: "Try again" })
    );
  });

  // FM-BOARD-1 on Choose: an old read can't say whether he's OUT now.
  webDbTest(
    "doesn't send a starter back as no longer OUT from an old read while ESPN can't be read",
    async ({ database }) => {
      forgetLastReads();
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const token = await managerOfTeam1(database.connection.db);
      await choose(token, "6606");
      setRefusingWebEspn("espn_unavailable");

      const result = await choose(token, "4065648");
      const markup = "markup" in result ? result.markup : "";

      expect(result).not.toEqual({ redirect: "/app?status=not_out" });
      expect(textOf(markup)).toContain("Can't reach ESPN right now");
    }
  );

  // FM-BOARD-4 on Choose: InjurySub's own outage is never worded as ESPN's.
  webDbTest.for([
    ["worker_unreachable", "Can't load your team right now"],
    ["credentials_rejected", "InjurySub lost its ESPN access"],
    ["not_connected", "ESPN isn't connected yet"],
  ] as const)("says why when the read fails as %s", async ([code, words], { database }) => {
    forgetLastReads();
    setRefusingWebEspn(code);
    const token = await managerOfTeam1(database.connection.db);

    const result = await choose(token, "6606");
    const markup = "markup" in result ? result.markup : "";

    expect(textOf(markup)).toContain(words);
    expect(textOf(markup)).not.toContain("Can't reach ESPN right now");
  });
});
