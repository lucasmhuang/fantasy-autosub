import { describe, expect } from "vitest";
import {
  callPage,
  insertInventedUser,
  insertSession,
  webDbTest,
} from "../../../../../lib/server/test-support";
import FileRequestPage from "./page";

const open = (token: string | null) =>
  callPage(token, () => FileRequestPage({ searchParams: Promise.resolve({}) }));

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the filing form's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=/commish/requests/new" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({ redirect: "/app" });
  });
});
