import { randomUUID } from "node:crypto";
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
import RequestPage from "./page";

const open = (token: string | null, id: string) =>
  callPage(token, () =>
    RequestPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })
  );

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the request page's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    const id = randomUUID();

    expect(await open(null, id)).toEqual({
      redirect: `/login?redirect=${encodeURIComponent(`/app/requests/${id}`)}`,
    });
  });

  webDbTest.for([["manager"], ["commissioner"]] as const)(
    "sends a %s without a team to the team page",
    async ([role], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role });

      expect(await open(await insertSession(db, userId, new Date()), randomUUID())).toEqual({
        redirect: "/app",
      });
    }
  );
});

// RS-REQUEST-7.
describe("the request page's redirects", () => {
  // The canvas's "Request · not found": a page, never naming whose request it is.
  webDbTest(
    "says there's no request here for another team's request, an unknown one, or a proving one",
    async ({ database }) => {
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { teamId: 1 });
      const token = await insertSession(db, userId, new Date());
      const otherTeams = await insertInventedRequest(db, { teamId: 2 });
      const proving = await insertInventedRequest(db, { kind: "proving", teamId: 1 });

      for (const id of [otherTeams, randomUUID(), "not-a-request-id", proving]) {
        const markup = await renderedMarkup(await open(token, id));
        expect(markup).toContain("No request here");
        expect(linksIn(markup)).toContainEqual({ href: "/app/requests", text: "Your requests" });
      }
    }
  );

  webDbTest(
    "sends the commissioner opening a proving request to the proving page",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
      const proving = await insertInventedRequest(db, { kind: "proving", teamId: 1 });

      expect(await open(await insertSession(db, userId, new Date()), proving)).toEqual({
        redirect: "/commish/proving",
      });
    }
  );
});
