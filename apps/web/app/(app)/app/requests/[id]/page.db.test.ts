import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import {
  callPage,
  insertInventedRequest,
  insertInventedUser,
  insertSession,
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
  webDbTest(
    "sends another team's request, or an unknown one, to the team page as not found",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { teamId: 1 });
      const token = await insertSession(db, userId, new Date());
      const otherTeams = await insertInventedRequest(db, { teamId: 2 });

      for (const id of [otherTeams, randomUUID(), "not-a-request-id"]) {
        expect(await open(token, id)).toEqual({ redirect: "/app?status=not_found" });
      }
    }
  );

  webDbTest.for([
    ["commissioner", "/commish/proving"],
    ["manager", "/app?status=not_found"],
  ] as const)(
    "sends a %s opening a proving request to %s",
    async ([role, destination], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role, teamId: 1 });
      const proving = await insertInventedRequest(db, { kind: "proving", teamId: 1 });

      expect(await open(await insertSession(db, userId, new Date()), proving)).toEqual({
        redirect: destination,
      });
    }
  );
});
