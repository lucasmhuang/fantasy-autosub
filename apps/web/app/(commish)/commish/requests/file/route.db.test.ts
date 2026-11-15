import { randomUUID } from "node:crypto";
import { subRequests } from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import {
  insertInventedUser,
  insertSession,
  setWebEspn,
  webDbTest,
} from "../../../../../lib/server/test-support";
import { POST } from "./route";

// The minute on the Pacific wall clock, as a datetime-local field sends it. Now is always today's
// ESPN day, which the scenario reads as its current one.
function pacificMinute(at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((each) => each.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function file(token: string, fields: Record<string, string> = {}) {
  const body = new URLSearchParams({
    team: "1",
    injured: "6606",
    replacement: "5144091",
    moment: pacificMinute(),
    designation: "OUT",
    replacementGame: "not_started",
    idempotencyKey: randomUUID(),
    ...fields,
  });
  return POST(
    new NextRequest("http://0.0.0.0:8080/commish/requests/file", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `injurysub_session=${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    })
  );
}

describe("POST /commish/requests/file", () => {
  webDbTest("files the request and opens it", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { role: "commissioner" });

    const response = await file(await insertSession(db, userId, new Date()));

    const [request] = await db.select().from(subRequests);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      `/commish/requests/${request?.requestId}`
    );
  });

  webDbTest("refuses a manager's filing, recording nothing", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { teamId: 2 });

    const response = await file(await insertSession(db, userId, new Date()));

    expect(response.status).toBe(403);
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  // RS-FILE-2: back on the form with why, the team kept.
  const hour = 60 * 60 * 1000;
  webDbTest.for([
    ["own_team_on_behalf", 1, () => pacificMinute()],
    ["moment_outside_matchup", null, () => pacificMinute(new Date(Date.now() - 30 * 24 * hour))],
    ["invalid_form", null, () => pacificMinute(new Date(Date.now() + 2 * hour))],
  ] as const)(
    "sends the commissioner back to the form with %s, keeping the team",
    async ([status, commissionerTeam, moment], { database }) => {
      const { db } = database.connection;
      setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
      const userId = await insertInventedUser(db, {
        role: "commissioner",
        teamId: commissionerTeam,
      });

      const response = await file(await insertSession(db, userId, new Date()), {
        moment: moment(),
      });

      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/commish/requests/new");
      expect([...location.searchParams]).toEqual([
        ["status", status],
        ["team", "1"],
      ]);
    }
  );
});
