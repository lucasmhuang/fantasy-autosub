import { describe, expect } from "vitest";
import { formsIn, renderedMarkup } from "../../../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  webDbTest,
} from "../../../../../lib/server/test-support";
import FileRequestPage from "./page";

const open = (token: string | null, searchParams: { team?: string } = {}) =>
  callPage(token, () => FileRequestPage({ searchParams: Promise.resolve(searchParams) }));

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

// RS-FILE-1: the commissioner never files on their own team's behalf.
describe("the filing form's team picker", () => {
  webDbTest.for([[{}], [{ team: "1" }]] as const)(
    "offers every team but the commissioner's own, with %o",
    async ([searchParams], { database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
      const token = await insertSession(db, userId, new Date());

      const markup = await renderedMarkup(await open(token, searchParams));

      const pickers = formsIn(markup).filter((form) => form.method === "get");
      expect(pickers).toEqual([
        {
          action: null,
          method: "get",
          fields: [
            expect.objectContaining({
              tag: "select",
              name: "team",
              options: "2,3,4,5,6,7,8,9,10,11,12",
            }),
          ],
        },
      ]);
      expect(formsIn(markup).map((form) => form.action)).not.toContain("/commish/requests/file");
    }
  );
});
