import { describe, expect } from "vitest";
import { callPage, insertInventedUser, insertSession, webDbTest } from "../lib/server/test-support";
import RootPage from "./page";

const open = (token: string | null) => callPage(token, () => RootPage());

// FS-SHELL-4, IF-SHELL-3: the root address has no page of its own.
describe("the root address", () => {
  webDbTest("sends a signed-out browser to sign in", async () => {
    expect(await open(null)).toEqual({ redirect: "/login" });
  });

  webDbTest.for([
    ["manager", 4, "/app"],
    ["commissioner", 1, "/app"],
    ["commissioner", null, "/commish/requests"],
  ] as const)(
    "sends a signed-in %s (team %s) to %s",
    async ([role, teamId, destination], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role, teamId });

      expect(await open(await insertSession(db, userId, new Date()))).toEqual({
        redirect: destination,
      });
    }
  );
});
