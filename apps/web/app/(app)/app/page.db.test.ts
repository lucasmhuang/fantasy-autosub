import { describe, expect } from "vitest";
import {
  callPage,
  insertInventedUser,
  insertSession,
  webDbTest,
} from "../../../lib/server/test-support";
import TeamPage from "./page";

const open = (token: string | null) =>
  callPage(token, () => TeamPage({ searchParams: Promise.resolve({}) }));

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the team page's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=/app" });
  });

  webDbTest("sends a commissioner without a team to the queue", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { role: "commissioner" });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/commish/requests",
    });
  });
});
