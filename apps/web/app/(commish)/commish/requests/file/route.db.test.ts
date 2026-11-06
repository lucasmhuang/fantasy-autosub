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

// This minute on the Pacific wall clock, as a datetime-local field sends it: always today's ESPN
// day, which the scenario reads as its current one.
function thisMinuteInPacific(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((each) => each.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function file(token: string) {
  const body = new URLSearchParams({
    team: "1",
    injured: "6606",
    replacement: "5144091",
    moment: thisMinuteInPacific(),
    designation: "OUT",
    replacementGame: "not_started",
    idempotencyKey: randomUUID(),
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
});
