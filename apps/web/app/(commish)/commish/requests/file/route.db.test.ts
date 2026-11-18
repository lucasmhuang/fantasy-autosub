import { randomUUID } from "node:crypto";
import { subRequests } from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { NextRequest } from "next/server";
import { describe, expect } from "vitest";
import { formsIn, renderedMarkup } from "../../../../../components/test-support";
import {
  callPage,
  insertInventedUser,
  insertSession,
  setWebEspn,
  webDbTest,
} from "../../../../../lib/server/test-support";
import FileRequestPage from "../new/page";
import { POST } from "./route";

// The minute on a zone's wall clock, as a datetime-local field sends it. Now is always today's
// ESPN day, which the scenario reads as its current one.
function wallMinute(zone = "America/Los_Angeles", at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
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

function post(token: string, body: URLSearchParams, accept?: string) {
  return POST(
    new NextRequest("http://0.0.0.0:8080/commish/requests/file", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `injurysub_session=${token}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(accept === undefined ? {} : { accept }),
      },
      body,
    })
  );
}

// A test names the moment the manager asked; the form posts it as its day and time.
function file(token: string, fields: Record<string, string> = {}, accept?: string) {
  const { moment = wallMinute(), ...rest } = fields;
  const body = new URLSearchParams({
    team: "1",
    injured: "6606",
    replacement: "5144091",
    day: moment.slice(0, 10),
    time: moment.slice(11),
    designation: "OUT",
    replacementGame: "not_started",
    idempotencyKey: randomUUID(),
    zone: "America/Los_Angeles",
    ...rest,
  });
  return post(token, body, accept);
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
    ["own_team_on_behalf", 1, () => wallMinute()],
    [
      "moment_outside_matchup",
      null,
      () => wallMinute(undefined, new Date(Date.now() - 30 * 24 * hour)),
    ],
    ["invalid_form", null, () => wallMinute(undefined, new Date(Date.now() + 2 * hour))],
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

// FS-TIME-6: the zone the form posted is the one its label showed; the session's zone, which can
// change while the form is open, plays no part.
describe("POST /commish/requests/file's moment", () => {
  webDbTest("reads the typed time in the posted zone, not the session's", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { role: "commissioner" });
    const token = await insertSession(db, userId, new Date(), { timeZone: "America/Chicago" });
    const typedAt = new Date();

    const response = await file(token, {
      moment: wallMinute("America/New_York", typedAt),
      zone: "America/New_York",
    });

    expect(response.status).toBe(303);
    const [request] = await db.select().from(subRequests);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/commish/requests/${request?.requestId}`
    );
    const minute = 60_000;
    expect(request?.requestMoment.getTime()).toBe(Math.floor(typedAt.getTime() / minute) * minute);
  });
});

// The form posts with fetch and asks for JSON, keeping what was typed on the page (IF-FILE-4).
describe("POST /commish/requests/file, answering the form's fetch", () => {
  const json = "application/json";

  webDbTest("answers a filing with where to go", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { role: "commissioner" });

    const response = await file(await insertSession(db, userId, new Date()), {}, json);

    const [request] = await db.select().from(subRequests);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "recorded",
      location: `/commish/requests/${request?.requestId}`,
    });
  });

  webDbTest("answers a form with problems with each one, filing nothing", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { role: "commissioner" });
    const hour = 60 * 60 * 1000;

    const response = await file(
      await insertSession(db, userId, new Date()),
      { moment: wallMinute(undefined, new Date(Date.now() + 2 * hour)) },
      json
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "not_filed",
      errors: [{ field: "time", code: "future" }],
      refusal: null,
    });
    expect(await db.select().from(subRequests)).toEqual([]);
  });
});

// RS-FILE-1: the form's fields are the route's contract. Whatever the form posts, filled in as a
// commissioner would, files the request.
describe("the filing form and its route", () => {
  const [day = "", time = ""] = wallMinute().split("T");
  const typed: Record<string, string> = {
    injured: "6606",
    replacement: "5144091",
    day,
    time,
    designation: "OUT",
    replacementGame: "not_started",
  };

  webDbTest("files what the form posts, field for field", async ({ database }) => {
    const { db } = database.connection;
    setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }));
    const userId = await insertInventedUser(db, { role: "commissioner" });
    const token = await insertSession(db, userId, new Date());
    const page = await callPage(token, () =>
      FileRequestPage({ searchParams: Promise.resolve({ team: "1" }) })
    );
    const [form] = formsIn(await renderedMarkup(page)).filter(
      (each) => each.action === "/commish/requests/file"
    );

    const body = new URLSearchParams();
    for (const field of form?.fields ?? []) {
      if (field.name === undefined || body.has(field.name)) continue;
      body.set(
        field.name,
        field.type === "hidden" ? (field.value ?? "") : (typed[field.name] ?? "")
      );
    }
    const response = await post(token, body);

    expect([...new Set(form?.fields.map((field) => field.name))].sort()).toEqual(
      [...Object.keys(typed), "idempotencyKey", "team", "zone"].sort()
    );
    expect(response.status).toBe(303);
    expect(await db.select().from(subRequests)).toHaveLength(1);
  });
});
