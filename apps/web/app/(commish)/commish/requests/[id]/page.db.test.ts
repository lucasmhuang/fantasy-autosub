import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import {
  callPage,
  insertInventedRequest,
  insertInventedUser,
  insertSession,
  webDbTest,
} from "../../../../../lib/server/test-support";
import CommissionerRequestPage from "./page";

const id = randomUUID();
const open = (
  token: string | null,
  requestId: string = id,
  searchParams: { status?: string } = {}
) =>
  callPage(token, () =>
    CommissionerRequestPage({
      params: Promise.resolve({ id: requestId }),
      searchParams: Promise.resolve(searchParams),
    })
  );

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the request detail's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({
      redirect: `/login?redirect=${encodeURIComponent(`/commish/requests/${id}`)}`,
    });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({ redirect: "/app" });
  });
});

// RS-DETAIL-1: a proving run's Approve and "put back" answer here, so the forward carries them.
describe("the request detail's redirects", () => {
  webDbTest("sends an unknown request to the queue", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });

    expect(await open(await insertSession(db, userId, new Date()), randomUUID())).toEqual({
      redirect: "/commish/requests",
    });
  });

  webDbTest.for([
    [undefined, "/commish/proving"],
    ["approved", "/commish/proving?status=approved"],
  ] as const)(
    "sends a proving request, with ?status=%s, to %s",
    async ([status, destination], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
      const proving = await insertInventedRequest(db, { kind: "proving", teamId: 1 });
      const token = await insertSession(db, userId, new Date());

      expect(await open(token, proving, status === undefined ? {} : { status })).toEqual({
        redirect: destination,
      });
    }
  );
});
