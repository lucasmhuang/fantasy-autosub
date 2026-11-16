import { createEspnReadClient } from "@injurysub/espn";
import { cutConnectionAt } from "@injurysub/test-db";
import { describe, expect } from "vitest";
import { renderedMarkup } from "../../../components/test-support";
import { createWebDatabaseConnection } from "../../../lib/server/db";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setWebEspn,
  webDbTest,
} from "../../../lib/server/test-support";
import TeamPage from "./page";

const open = (token: string | null, searchParams: Record<string, string> = {}) =>
  callPage(token, () => TeamPage({ searchParams: Promise.resolve(searchParams) }));

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the team page's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fapp" });
  });

  webDbTest("keeps the starter asked for when it sends a browser to sign in", async () => {
    expect(await open(null, { starter: "6606" })).toEqual({
      redirect: `/login?redirect=${encodeURIComponent("/app?starter=6606")}`,
    });
  });

  webDbTest("sends a commissioner without a team to the queue", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { role: "commissioner" });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/commish/requests",
    });
  });
});

describe("the team page", () => {
  webDbTest("shows a manager's team, its OUT starter first, in the shell", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { teamId: 1 });

    const markup = await renderedMarkup(await open(await insertSession(db, userId, new Date())));

    expect(markup).toContain("1 starter is OUT");
    expect(markup).toContain("Invented · team 1");
    expect(markup).toContain('class="tabbar');
  });

  webDbTest("says a manager without a team has no team yet", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db);

    const markup = await renderedMarkup(await open(await insertSession(db, userId, new Date())));

    expect(markup).toContain("No team yet");
  });

  webDbTest(
    "shows the database-down page, outside the shell, when the team's requests can't be read",
    async ({ database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const token = await insertSession(
        db,
        await insertInventedUser(db, { teamId: 1 }),
        new Date()
      );
      const proxy = await cutConnectionAt(database.url, 'from "sub_requests"');
      const cut = createWebDatabaseConnection(proxy.url);
      globalThis.__injurysubWebDb = cut;
      let markup: string;
      try {
        markup = await renderedMarkup(await open(token));
      } finally {
        await cut.close();
        await proxy.close();
        globalThis.__injurysubWebDb = database.connection;
      }

      expect(markup.replaceAll("&#x27;", "'")).toContain("Can't load InjurySub right now");
      expect(markup).not.toContain('class="tabbar');
    }
  );
});
