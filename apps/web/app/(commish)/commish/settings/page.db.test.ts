import { markProvingDone, recordTeamNames, writeLeagueSettings } from "@injurysub/db";
import { cutConnectionAt } from "@injurysub/test-db";
import { describe, expect } from "vitest";
import { formsIn, linksIn, renderedMarkup } from "../../../../components/test-support";
import { createWebDatabaseConnection } from "../../../../lib/server/db";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setRefusingWebEspn,
  webDbTest,
} from "../../../../lib/server/test-support";
import CommissionerSettingsPage from "./page";

const open = (token: string | null, searchParams: { status?: string } = {}) =>
  callPage(token, () => CommissionerSettingsPage({ searchParams: Promise.resolve(searchParams) }));

type Db = Parameters<typeof insertInventedUser>[0];

// The commissioner on team 1, the shell's worker refusing (none answers here).
async function commissioner(db: Db) {
  setRefusingWebEspn("worker_unreachable");
  const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
  return { userId, token: await insertSession(db, userId, new Date()) };
}

async function pageText(token: string, searchParams: { status?: string } = {}) {
  const markup = await renderedMarkup(await open(token, searchParams));
  // The words a reader sees, tags removed.
  return { markup, text: markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'") };
}

// RS-SHELL-3: each page guards itself, so each page's guard has its own test.
describe("the settings page's guard", () => {
  webDbTest("sends a browser without a session to sign in, coming back here", async () => {
    expect(await open(null)).toEqual({ redirect: "/login?redirect=%2Fcommish%2Fsettings" });
  });

  webDbTest("sends a manager to the team page", async ({ database }) => {
    const { db } = database.connection;
    const userId = await insertInventedUser(db, { teamId: 2 });

    expect(await open(await insertSession(db, userId, new Date()))).toEqual({
      redirect: "/app?status=commissioner_page",
    });
  });
});

// FS-SHELL-7, Revision 4 A and C: the automation line under the title, its switch answering here.
describe("the settings page's automation line", () => {
  webDbTest("draws the line, its switch posting this page", async ({ database }) => {
    const { db } = database.connection;
    // The shell asks the worker for its bar; none answers here.
    setRefusingWebEspn("worker_unreachable");
    const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
    await writeLeagueSettings(db, {
      executionMode: "approval_required",
      writeAllowlist: [1, 4],
      updatedBy: userId,
      now: new Date(),
      shownUpdatedAt: null,
    });
    const token = await insertSession(db, userId, new Date());
    const markup = await renderedMarkup(await open(token));

    expect(markup.match(/class="autostrip/g)).toHaveLength(1);
    expect(markup).toContain(`<input type="hidden" name="from" value="/commish/settings"/>`);
    expect(markup.replaceAll("<!-- -->", "")).toContain("Automation on");
  });
});

// FS-SETTINGS-1 to -4, RS-SETTINGS-1: the form, its field names the save route's contract.
describe("the settings form", () => {
  webDbTest("posts the mode, one team per tick and the shown save's time", async ({ database }) => {
    const { db } = database.connection;
    const { userId, token } = await commissioner(db);
    await writeLeagueSettings(db, {
      executionMode: "auto",
      writeAllowlist: [2],
      updatedBy: userId,
      now: new Date(),
      shownUpdatedAt: null,
    });

    const { markup, text } = await pageText(token);

    const [form] = formsIn(markup).filter((each) => each.action === "/commish/settings/save");
    expect([...new Set(form?.fields.map((field) => field.name))].sort()).toEqual(
      ["executionMode", "shownUpdatedAt", "team", undefined].sort()
    );
    expect(form?.fields.filter((field) => field.name === "team")).toHaveLength(12);
    expect(form?.fields).toContainEqual(
      expect.objectContaining({ name: "executionMode", value: "auto", checked: "" })
    );
    expect(form?.fields).toContainEqual(
      expect.objectContaining({ name: "team", value: "2", checked: "" })
    );
    expect(text).toContain("Applies to requests confirmed from now on.");
    expect(text).toContain("A ticked team's requests run without you.");
    expect(text).toContain(
      "Unticking a team also stops its waiting requests before anything is sent."
    );
    expect(text).toContain("Save settings");
  });

  webDbTest(
    "names each team and its manager, the commissioner's own as you",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await commissioner(db);
      await recordTeamNames(db, { teams: [{ teamId: 2, name: "Glass Cannons" }], now: new Date() });
      await insertInventedUser(db, { teamId: 2 });

      const { text } = await pageText(token);

      expect(text).toContain("All teams");
      expect(text).toContain("Team 1 · you");
      expect(text).toContain("Glass Cannons · Invented");
      expect(text).toContain("A ticked team's requests wait for your approval.");
    }
  );

  webDbTest.for([
    ["saved", "Saved "],
    ["settings_changed", "Settings changed in another tab at "],
  ] as const)("answers %s naming the save's time", async ([status, words], { database }) => {
    const { db } = database.connection;
    const { userId, token } = await commissioner(db);
    await writeLeagueSettings(db, {
      executionMode: "approval_required",
      writeAllowlist: [],
      updatedBy: userId,
      now: new Date(),
      shownUpdatedAt: null,
    });

    const { text } = await pageText(token, { status });

    // Saved moments ago: today, so the time needs no weekday (FS-TIME-7).
    expect(text).toMatch(new RegExp(`${words}(?:\\w{3} )?\\d{1,2}:\\d{2} [AP]M`));
  });

  webDbTest(
    "shows the database-down page when the settings can't be read",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await commissioner(db);
      const proxy = await cutConnectionAt(database.url, 'from "league_settings"');
      const cut = createWebDatabaseConnection(proxy.url);
      globalThis.__injurysubWebDb = cut;
      let text: string;
      try {
        text = (await pageText(token)).text;
      } finally {
        await cut.close();
        await proxy.close();
        globalThis.__injurysubWebDb = database.connection;
      }

      expect(text).toContain("Can't load InjurySub right now");
      expect(text).not.toContain("Text your commissioner");
    }
  );
});

// The "Mark proving done" button's opening tag.
function markDoneButton(markup: string): string {
  return markup.match(/<button[^>]*>(?:(?!<\/button>).)*Mark proving done/s)?.[0] ?? "";
}

// FS-SETTINGS-1, -4: the defaults, approval required with no team ticked.
describe("the settings form's defaults", () => {
  webDbTest(
    "reads approval required with no team ticked, each mode described",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await commissioner(db);

      const { markup, text } = await pageText(token);

      const [form] = formsIn(markup).filter((each) => each.action === "/commish/settings/save");
      expect(form?.fields).toContainEqual(
        expect.objectContaining({ name: "executionMode", value: "approval_required", checked: "" })
      );
      expect(form?.fields.filter((field) => field.name === "team" && "checked" in field)).toEqual(
        []
      );
      for (const words of [
        "Approval required",
        "You approve each request before it runs.",
        "Auto",
        "Requests that move at most one other starter run without you.",
      ]) {
        expect(text).toContain(words);
      }
    }
  );
});

// FS-SETTINGS-5, IF-SETTINGS-3, SC-SETTINGS-3: proving on the commissioner's own team.
describe("the settings page's proving panel", () => {
  webDbTest("opens proving and marks it done, until it's done", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await commissioner(db);

    const { markup, text } = await pageText(token);

    expect(text).toContain("Not done. Run it once before ticking other teams.");
    expect(linksIn(markup)).toContainEqual({ href: "/commish/proving", text: "Open proving" });
    expect(formsIn(markup).map((form) => form.action)).toContain("/commish/proving/done");
    expect(markDoneButton(markup)).not.toContain("disabled");
  });

  webDbTest("says when it was done, and can't be marked again", async ({ database }) => {
    const { db } = database.connection;
    const { userId, token } = await commissioner(db);
    await markProvingDone(db, { updatedBy: userId, now: new Date() });

    const { markup, text } = await pageText(token);

    expect(text).toMatch(/Done \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M/);
    expect(markDoneButton(markup)).toContain("disabled");
  });
});
