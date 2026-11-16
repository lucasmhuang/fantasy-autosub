import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { linksIn, renderedMarkup } from "../../../../../components/test-support";
import {
  callPage,
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  setWebEspn,
  webDbTest,
} from "../../../../../lib/server/test-support";
import RequestsPage from "./page";

const open = (token: string | null) => callPage(token, () => RequestsPage());

const requestLinks = (markup: string) =>
  linksIn(markup)
    .map((link) => link.href)
    .filter(
      (href): href is string => href !== null && /^\/app\/requests\/[0-9a-f-]{36}$/.test(href)
    );

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the requests list's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({
      redirect: `/login?redirect=${encodeURIComponent("/app/requests")}`,
    });
  });

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

// FS-LIST-1, FS-LIST-2, IF-LIST-1.
describe("the requests list", () => {
  webDbTest(
    "lists the team's own requests, newest first, each opening its page",
    async ({ database }) => {
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { teamId: 1 });
      const older = await insertInventedRequest(db, {
        requestedBy: userId,
        status: "withdrawn",
        createdAt: new Date("2026-10-27T02:00:00.000Z"),
      });
      const newer = await insertInventedRequest(db, {
        requestedBy: userId,
        status: "completed",
        createdAt: new Date("2026-10-28T02:00:00.000Z"),
      });
      const otherTeams = await insertInventedRequest(db, { teamId: 2 });

      const markup = await renderedMarkup(await open(await insertSession(db, userId, new Date())));

      expect(markup).toContain("Your requests");
      expect(requestLinks(markup)).toEqual([`/app/requests/${newer}`, `/app/requests/${older}`]);
      expect(markup).not.toContain(otherTeams);
    }
  );

  webDbTest("says there are none yet", async ({ database }) => {
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 1 });

    const markup = await renderedMarkup(await open(await insertSession(db, userId, new Date())));

    expect(markup).toContain("No requests yet.");
    expect(requestLinks(markup)).toEqual([]);
  });
});
