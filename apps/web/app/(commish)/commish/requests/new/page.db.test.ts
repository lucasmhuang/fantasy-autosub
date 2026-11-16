import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { formsIn, renderedMarkup } from "../../../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  setWebEspn,
  webDbTest,
} from "../../../../../lib/server/test-support";
import FileRequestPage from "./page";

const open = (token: string | null, searchParams: { team?: string } = {}) =>
  callPage(token, () => FileRequestPage({ searchParams: Promise.resolve(searchParams) }));

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the filing form's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fcommish%2Frequests%2Fnew" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});

// RS-FILE-1: the commissioner never files on their own team's behalf.
describe("the filing form's team picker", () => {
  webDbTest.for([[{}], [{ team: "1" }]] as const)(
    "offers every team but the commissioner's own, with %o",
    async ([searchParams], { database }) => {
      const { db } = database.connection;
      // The shell asks the worker for its bar; none answers here.
      setRefusingWebEspn("worker_unreachable");
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

// FS-TIME-6: the form names the zone it reads the typed time in, the device's, and posts it.
describe("the filing form's moment", () => {
  webDbTest.for([
    ["America/New_York", "(ET)"],
    [null, "(PT)"],
  ] as const)(
    "for a device whose zone is %s, says %s and posts that zone",
    async ([timeZone, label], { database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
      const token = await insertSession(db, userId, new Date(), { timeZone });

      const markup = await renderedMarkup(await open(token, { team: "2" }));

      const [form] = formsIn(markup).filter((each) => each.action === "/commish/requests/file");
      expect(form?.fields).toContainEqual({
        tag: "input",
        type: "hidden",
        name: "zone",
        value: timeZone ?? "America/Los_Angeles",
      });
      // React separates adjacent text with comments; the reader sees one line.
      expect(markup.replaceAll("<!-- -->", "")).toContain(`When the manager asked ${label}`);
    }
  );
});
