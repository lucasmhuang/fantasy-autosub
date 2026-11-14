import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  listAcknowledgedMisuseAlerts,
  listOpenMisuseAlerts,
  readLeagueSettings,
  recordMisuseAlert,
  recordMisuseWatch,
  writeLeagueSettings,
} from "@injurysub/db";
import { writeGateFor } from "@injurysub/domain";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import { loadAlertsPage, loadAutomationSwitch } from "../../../../lib/server/commish-alerts";
import { insertInventedUser, insertSession, webDbTest } from "../../../../lib/server/test-support";
import { POST as switchOff } from "../automation/off/route";
import { POST as switchOn } from "../automation/on/route";
import { POST as acknowledge } from "./[id]/acknowledge/route";

const appOrigin = "http://localhost:3000";

function post(path: string, token: string, origin = appOrigin) {
  return new NextRequest(`http://0.0.0.0:8080${path}`, {
    method: "POST",
    headers: {
      origin,
      cookie: `injurysub_session=${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({}),
  });
}

function location(response: Response): URL {
  expect(response.status).toBe(303);
  return new URL(response.headers.get("location") ?? "");
}

async function signedIn(db: DatabaseExecutor, role: "commissioner" | "manager", teams = [1, 4]) {
  const userId = await insertInventedUser(db, { role, teamId: 1 });
  await writeLeagueSettings(db, {
    executionMode: "approval_required",
    writeAllowlist: teams,
    updatedBy: userId,
    now: new Date(),
    shownUpdatedAt: null,
  });
  return { userId, token: await insertSession(db, userId, new Date()) };
}

async function insertAlert(db: DatabaseExecutor, overrides: Record<string, unknown> = {}) {
  const { alert } = await recordMisuseAlert(db, {
    alertId: randomUUID(),
    espnRef: `transaction:${randomUUID()}`,
    kind: "lm_transaction",
    teamId: 4,
    teamName: "Invented Team",
    espnAt: new Date("2026-11-15T21:00:00.000Z"),
    details: { what: "An edit.", undo: ["Move it back."] },
    foundAt: new Date("2026-11-15T21:02:00.000Z"),
    ...overrides,
  });
  return alert;
}

function acknowledgeAlert(alertId: string, token: string, origin?: string) {
  return acknowledge(post(`/commish/alerts/${alertId}/acknowledge`, token, origin), {
    params: Promise.resolve({ id: alertId }),
  });
}

// M5.
describe("acknowledging a misuse alert", () => {
  webDbTest(
    "takes it off the open alerts, recording who and when, and keeps it on record",
    async ({ database }) => {
      const { db } = database.connection;
      const { userId, token } = await signedIn(db, "commissioner");
      const alert = await insertAlert(db);

      const response = await acknowledgeAlert(alert.alertId, token);

      expect(location(response).pathname).toBe("/commish/alerts");
      expect(location(response).searchParams.get("status")).toBe("acknowledged");
      expect(await listOpenMisuseAlerts(db)).toEqual([]);
      const page = await loadAlertsPage();
      expect(page.status === "found" && page.acknowledged).toMatchObject([
        { alertId: alert.alertId, acknowledgedAt: expect.any(Date) },
      ]);
      expect(await listAcknowledgedMisuseAlerts(db, 10)).toMatchObject([
        { alertId: alert.alertId, acknowledgedBy: userId },
      ]);
    }
  );

  webDbTest("refuses a manager, and another site", async ({ database }) => {
    const { db } = database.connection;
    const manager = await signedIn(db, "manager");
    const alert = await insertAlert(db);

    expect((await acknowledgeAlert(alert.alertId, manager.token)).status).toBe(403);
    expect(
      (await acknowledgeAlert(alert.alertId, manager.token, "https://elsewhere.example")).status
    ).toBe(403);
    expect(await listOpenMisuseAlerts(db)).toHaveLength(1);
  });
});

// O11, Dec-D31e.
describe("the automation switch", () => {
  webDbTest(
    "switches automation off from any commissioner page, so the next write check refuses",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedIn(db, "commissioner", [1, 4]);

      const response = await switchOff(post("/commish/automation/off", token));

      expect(location(response).pathname).toBe("/commish/requests");
      expect(location(response).searchParams.get("status")).toBe("automation_switched_off");
      const settings = await readLeagueSettings(db);
      expect(settings.writeAllowlist).toEqual([]);
      expect(writeGateFor(settings.writeAllowlist, 1)).toBe("automation_off");
      expect(await loadAutomationSwitch()).toEqual({
        status: "switched_off",
        mode: "approval_required",
        teamCount: 2,
      });
    }
  );

  webDbTest("switches it back on with the mode and teams it had", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "commissioner", [1, 4]);
    await switchOff(post("/commish/automation/off", token));

    const response = await switchOn(post("/commish/automation/on", token));

    expect(location(response).searchParams.get("status")).toBe("automation_switched_on");
    expect(await readLeagueSettings(db)).toMatchObject({
      executionMode: "approval_required",
      writeAllowlist: [1, 4],
      allowlistBeforeOff: null,
    });
    expect(await loadAutomationSwitch()).toEqual({
      status: "on",
      mode: "approval_required",
      teamCount: 2,
    });
  });

  webDbTest(
    "reads automation off in the settings as off, with nothing to restore",
    async ({ database }) => {
      const { db } = database.connection;
      const { token } = await signedIn(db, "commissioner", []);

      const response = await switchOff(post("/commish/automation/off", token));

      expect(location(response).searchParams.get("status")).toBe("automation_unchanged");
      expect(await loadAutomationSwitch()).toEqual({ status: "off" });
    }
  );

  webDbTest("refuses a manager", async ({ database }) => {
    const { db } = database.connection;
    const { token } = await signedIn(db, "manager", [1]);

    expect((await switchOff(post("/commish/automation/off", token))).status).toBe(403);
    expect((await readLeagueSettings(db)).writeAllowlist).toEqual([1]);
  });
});

// M6, M9.
const move = {
  at: "2026-11-15T20:00:00.000Z",
  type: "ROSTER",
  byLeagueManager: false,
  items: [{ type: "LINEUP", player: "Invented Player", fromSlot: "BE", toSlot: "G" }],
};

describe("the alerts page", () => {
  webDbTest(
    "shows the open alerts, whether the watch is reading, and the commissioner team's moves",
    async ({ database }) => {
      const { db } = database.connection;
      await signedIn(db, "commissioner");
      const alert = await insertAlert(db, { foundBeforeWatch: true });
      const checkedAt = new Date("2026-11-15T21:05:00.000Z");
      await recordMisuseWatch(db, {
        state: "working",
        code: null,
        checkedAt,
        firstRunAt: checkedAt,
        teamMoves: [move],
      });

      const page = await loadAlertsPage();

      expect(page).toEqual({
        status: "found",
        watch: { state: "watching", checkedAt },
        open: [
          {
            alertId: alert.alertId,
            kind: "lm_transaction",
            teamName: "Invented Team",
            espnAt: alert.espnAt,
            what: "An edit.",
            undo: ["Move it back."],
            foundBeforeWatch: true,
            acknowledgedAt: null,
            acknowledgedNote: null,
          },
        ],
        acknowledged: [],
        teamMoves: [{ ...move, at: new Date(move.at) }],
      });
    }
  );

  webDbTest("shows the watch paused, and why, or not started", async ({ database }) => {
    const { db } = database.connection;
    expect(await loadAlertsPage()).toMatchObject({
      watch: { state: "not_started" },
      teamMoves: [],
    });
    const since = new Date("2026-11-15T21:00:00.000Z");
    await recordMisuseWatch(db, {
      state: "credentials_rejected",
      code: "credentials_rejected",
      checkedAt: since,
    });

    expect(await loadAlertsPage()).toMatchObject({
      watch: { state: "paused", reason: "credentials_rejected", since },
    });
  });
});
