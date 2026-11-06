import { once } from "node:events";
import type { Server } from "node:http";
import { createLogger } from "@injurysub/config";
import {
  createEspnReadClient,
  createInternalReadClient,
  EspnError,
  type InternalReadClient,
  type LeagueRulesRead,
  type TeamWeekRead,
} from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerRuntimeState } from "./health";
import { startWorkerHttpServer } from "./http-server";
import { addressOf, localFetch } from "./test-http";

// The web's proxy, from @injurysub/espn, against the worker's real server: the read names, paths,
// arguments, answers and error codes must agree across the boundary, not just on each side.
const token = "t".repeat(64);
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.restoreAllMocks();
});

async function proxyTo(espn: InternalReadClient) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const server = startWorkerHttpServer({
    port: 0,
    runtimeState: createWorkerRuntimeState(15_000),
    logger: createLogger("worker", "debug"),
    dependencyChecks: [],
    isReady: () => true,
    espn,
    internalToken: token,
  });
  servers.push(server);
  await once(server, "listening");
  return createInternalReadClient({
    baseUrl: `http://127.0.0.1:${addressOf(server)}`,
    token,
    fetch: localFetch,
  });
}

// The read's own clock aside, which differs between two reads.
function withoutReadTime<Read extends TeamWeekRead | LeagueRulesRead>(read: Read): Read {
  return { ...read, meta: { ...read.meta, readAt: "read time" } };
}

describe("the worker's internal read API, through the web's proxy", () => {
  it("gives the web the same team week as reading the client directly", async () => {
    const espn = createEspnReadClient({ mode: "stub" });
    const proxy = await proxyTo(espn);

    expect(withoutReadTime(await proxy.getTeamWeek(1))).toEqual(
      withoutReadTime(await espn.getTeamWeek(1))
    );
  });

  it("gives the web the same league rules check as the client, mismatches included", async () => {
    const espn = createEspnReadClient({ mode: "scripted", scenario: "rules-mismatch" });
    const proxy = await proxyTo(espn);

    const direct = await espn.checkLeagueRules();
    expect(direct.mismatches.length).toBeGreaterThan(0);
    expect(withoutReadTime(await proxy.checkLeagueRules())).toEqual(withoutReadTime(direct));
  });

  it("carries an ESPN failure's code across", async () => {
    const proxy = await proxyTo(
      createEspnReadClient({ mode: "scripted", scenario: "credentials-rejected" })
    );

    const failure = await proxy.getTeamWeek(1).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EspnError);
    expect(failure).toMatchObject({ code: "credentials_rejected" });
  });
});
