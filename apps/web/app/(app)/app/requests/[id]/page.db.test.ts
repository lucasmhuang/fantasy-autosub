import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import {
  callPage,
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
