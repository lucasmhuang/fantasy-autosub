import { recordTeamNames } from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { afterEach, describe, expect, vi } from "vitest";
import { loadShell, type ShellSession } from "./shell";
import {
  insertInventedRequest,
  insertInventedUser,
  setRefusingWebEspn,
  setWebEspn,
  webDbTest,
} from "./test-support";

afterEach(() => {
  vi.restoreAllMocks();
});

const scripted = () => createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" });

function signedIn(role: "manager" | "commissioner", teamId: number | null): ShellSession {
  return {
    user: { role, displayName: "Invented Person", email: "person@example.test", teamId },
    session: { timeZone: null },
  };
}

// FS-SHELL-1 to -3, -6: what every signed-in page's shell shows of the account, the queue and the
// worker.
describe("loadShell", () => {
  webDbTest("gives a manager their account and team, and no queue count", async () => {
    setWebEspn(scripted());

    expect(await loadShell(signedIn("manager", 7))).toEqual({
      account: { initial: "I", email: "person@example.test", team: "Team 7" },
      commissioner: false,
      commissionerName: null,
      waiting: null,
      bar: null,
      zone: null,
    });
  });

  // FS-APP-14: the team by the name InjurySub stored, with no ESPN read.
  webDbTest("gives the team by its stored name", async ({ database }) => {
    setWebEspn(scripted());
    await recordTeamNames(database.connection.db, {
      teams: [{ teamId: 7, name: "Stretch Fours" }],
      now: new Date("2026-11-17T04:00:00.000Z"),
    });

    expect((await loadShell(signedIn("manager", 7))).account.team).toBe("Stretch Fours");
  });

  webDbTest("names the league's active commissioner, for the pages' copy", async ({ database }) => {
    setWebEspn(scripted());
    await insertInventedUser(database.connection.db, { role: "commissioner", teamId: 1 });

    expect((await loadShell(signedIn("manager", 7))).commissionerName).toBe("Invented Person");
  });

  webDbTest(
    "gives the commissioner the count of requests waiting on them",
    async ({ database }) => {
      setWebEspn(scripted());
      const { db } = database.connection;
      await insertInventedRequest(db, { status: "awaiting_approval", teamId: 5 });
      await insertInventedRequest(db, { status: "needs_review", teamId: 6 });
      await insertInventedRequest(db, { status: "completed", teamId: 8 });

      expect(await loadShell(signedIn("commissioner", 1))).toMatchObject({
        commissioner: true,
        waiting: 2,
      });
    }
  );

  webDbTest.for([
    { sendMode: "never", bar: "rehearsal" },
    { sendMode: "practice", bar: "practice" },
    { sendMode: "live", bar: null },
  ] as const)(
    "shows the $bar bar while the worker's send mode is $sendMode",
    async ({ sendMode, bar }) => {
      setWebEspn(scripted(), undefined, sendMode);

      expect((await loadShell(signedIn("manager", 1))).bar).toBe(bar);
    }
  );

  webDbTest("shows no bar while the worker doesn't answer", async ({ webLog }) => {
    setRefusingWebEspn("worker_unreachable");

    expect((await loadShell(signedIn("manager", 1))).bar).toBe(null);
    expect(webLog.events()).toContainEqual(
      expect.objectContaining({ event: "web.worker.status_unread", code: "worker_unreachable" })
    );
  });
});
