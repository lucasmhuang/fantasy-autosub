import { once } from "node:events";
import type { Server } from "node:http";
import { createLogger } from "@injurysub/config";
import { EspnError, type TeamWeekRead } from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerRuntimeState } from "./health";
import { startWorkerHttpServer, type WorkerHttpServerOptions } from "./http-server";
import { askServer } from "./test-http";

const token = "t".repeat(64);
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.restoreAllMocks();
});

function quietLogger() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  return createLogger("worker", "debug");
}

// A read client whose getTeamWeek gives `answer` (or throws it), recording each team asked for.
function fakeEspn(answer: TeamWeekRead | Error) {
  const asked: number[] = [];
  return {
    asked,
    espn: {
      getTeamWeek: async (teamId: number) => {
        asked.push(teamId);
        if (answer instanceof Error) throw answer;
        return answer;
      },
      checkLeagueRules: async () => Promise.reject(new Error("not asked")),
    },
  };
}

const teamWeek = { teamId: 1, invented: "a team week" } as unknown as TeamWeekRead;

async function startServer(overrides: Partial<WorkerHttpServerOptions> = {}) {
  const server = startWorkerHttpServer({
    port: 0,
    runtimeState: createWorkerRuntimeState(15_000),
    logger: quietLogger(),
    dependencyChecks: [],
    isReady: () => true,
    espn: fakeEspn(teamWeek).espn,
    internalToken: token,
    ...overrides,
  });
  servers.push(server);
  await once(server, "listening");
  return server;
}

function readTeamWeek(server: Server, body: unknown, authorization = `Bearer ${token}`) {
  return askServer(server, {
    method: "POST",
    path: "/internal/espn/team-week",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify(body),
  });
}

describe("the worker's health endpoint", () => {
  it("answers 503 until the worker is ready, then 200", async () => {
    let ready = false;
    const server = await startServer({ isReady: () => ready });

    const before = await askServer(server, { path: "/health" });
    ready = true;
    const after = await askServer(server, { path: "/health" });

    expect([before.status, JSON.parse(before.body).ready]).toEqual([503, false]);
    expect([after.status, JSON.parse(after.body).ready]).toEqual([200, true]);
  });
});

describe("the worker's internal ESPN API", () => {
  it("refuses a request without the token, or with a wrong one, reading nothing", async () => {
    const { espn, asked } = fakeEspn(teamWeek);
    const server = await startServer({ espn });

    const missing = await askServer(server, {
      method: "POST",
      path: "/internal/espn/team-week",
      body: JSON.stringify({ teamId: 1 }),
    });
    const wrong = await readTeamWeek(server, { teamId: 1 }, `Bearer ${"x".repeat(64)}`);

    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(asked).toEqual([]);
  });

  it("answers a read with the client's result", async () => {
    const { espn, asked } = fakeEspn(teamWeek);
    const server = await startServer({ espn });

    const response = await readTeamWeek(server, { teamId: 1 });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, result: teamWeek });
    expect(asked).toEqual([1]);
  });

  it("passes an ESPN failure on as its code alone", async () => {
    const failure = new EspnError(
      "credentials_rejected",
      "ESPN refused the cookie (reading team 1's week)"
    );
    const server = await startServer({ espn: fakeEspn(failure).espn });

    const response = await readTeamWeek(server, { teamId: 1 });

    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ ok: false, code: "credentials_rejected" });
  });

  // EspnError messages never hold the URL or the cookies (packages/espn read/request.ts), and the
  // message is what tells an operator which player or field ESPN's answer tripped on.
  it("logs an ESPN failure with its read, code and message", async () => {
    const failure = new EspnError(
      "unrecognized_response",
      "unrecognized lineup slot 15 for team 8, player Invented Player (1)"
    );
    const server = await startServer({ espn: fakeEspn(failure).espn });
    const warn = vi.mocked(console.warn);

    await readTeamWeek(server, { teamId: 1 });

    const lines = warn.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "worker.internal_api.espn_failed",
        read: "getTeamWeek",
        code: "unrecognized_response",
        message: "unrecognized lineup slot 15 for team 8, player Invented Player (1)",
      })
    );
  });

  it("refuses arguments that don't fit the read, and a read that doesn't exist", async () => {
    const server = await startServer();

    const badArguments = await readTeamWeek(server, { teamId: "one" });
    const unknownRead = await askServer(server, {
      method: "POST",
      path: "/internal/espn/write-lineup",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
    });

    expect([badArguments.status, JSON.parse(badArguments.body)]).toEqual([
      400,
      { ok: false, code: "invalid_arguments" },
    ]);
    expect(unknownRead.status).toBe(404);
  });

  it("answers an unexpected failure with a fixed code, keeping its message out", async () => {
    const server = await startServer({ espn: fakeEspn(new TypeError("invented details")).espn });

    const response = await readTeamWeek(server, { teamId: 1 });

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ ok: false, code: "internal_error" });
  });
});
