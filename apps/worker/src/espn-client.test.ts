import { loadServerEnv } from "@injurysub/config";
import { EspnError, type LineupWrite, type WriteGuard } from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerEspnClient, createWorkerWriteClient, workerSendMode } from "./espn-client";
import { WorkerStartupError } from "./startup-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Records every URL asked for, answering none.
function recordRequests(): string[] {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(String(url));
    throw new Error("no request expected");
  });
  return requested;
}

async function rejectionOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
  } catch (error) {
    return error;
  }
  throw new Error("expected the read to fail");
}

describe("createWorkerEspnClient", () => {
  it("refuses every read without credentials in none mode, sending nothing", async () => {
    const requested = recordRequests();
    const client = createWorkerEspnClient(loadServerEnv({ ESPN_MODE: "none" }));

    expect(client.mode).toBe("none");
    expect(await rejectionOf(client.getTeamWeek(1))).toMatchObject({ code: "not_connected" });
    expect(requested).toEqual([]);
  });

  it("reads the named scenario in scripted mode, sending nothing", async () => {
    const requested = recordRequests();
    const client = createWorkerEspnClient(
      loadServerEnv({ ESPN_MODE: "scripted", ESPN_SCENARIO: "credentials-rejected" })
    );

    expect(client.mode).toBe("scripted");
    const failure = await rejectionOf(client.getTeamWeek(1));
    expect(failure).toBeInstanceOf(EspnError);
    expect(failure).toMatchObject({ code: "credentials_rejected" });
    expect(requested).toEqual([]);
  });

  it("refuses a scenario that doesn't exist, naming the setting and not the value", () => {
    const build = () =>
      createWorkerEspnClient(
        loadServerEnv({ ESPN_MODE: "scripted", ESPN_SCENARIO: "no-such-scenario" })
      );

    expect(build).toThrow(WorkerStartupError);
    expect(build).toThrow(/ESPN_SCENARIO/);
    expect(build).not.toThrow(/no-such-scenario/);
  });

  it("reads the committed recordings in stub mode", () => {
    expect(createWorkerEspnClient(loadServerEnv({})).mode).toBe("stub");
  });

  it("reads live ESPN in live mode", () => {
    const env = loadServerEnv({
      ESPN_MODE: "live",
      ESPN_S2: "s2",
      ESPN_SWID: "{swid}",
      LEAGUE_ID: "1",
    });

    expect(createWorkerEspnClient(env).mode).toBe("live");
  });
});

// Synthetic values: the real league id and cookies never appear in tests.
const liveEspn = {
  ESPN_MODE: "live",
  ESPN_S2: "AEBsyntheticCookieValue",
  ESPN_SWID: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
  LEAGUE_ID: "4567123",
};
const lineupWrite: LineupWrite = {
  teamId: 1,
  scoringPeriodId: 25,
  moves: [
    { playerId: 101, fromSlot: "C", toSlot: "BE" },
    { playerId: 103, fromSlot: "BE", toSlot: "C" },
  ],
};
const guard: WriteGuard = { allowlist: new Set([1]), beforeSend: async () => {} };

describe("createWorkerWriteClient", () => {
  it("builds no write client in none mode", () => {
    expect(createWorkerWriteClient(loadServerEnv({ ESPN_MODE: "none" }))).toBe(null);
  });

  it.each([
    { ESPN_MODE: "stub" },
    { ESPN_MODE: "scripted", ESPN_SCENARIO: "one-out-starter" },
    liveEspn,
  ])("records each write without sending it while the send mode is never ($ESPN_MODE)", async (espn) => {
    const requested = recordRequests();
    const client = createWorkerWriteClient(loadServerEnv(espn));

    expect(await client?.applyLineup(lineupWrite, guard)).toMatchObject({
      outcome: "recorded_only",
      body: { teamId: 1, scoringPeriodId: 25 },
    });
    expect(requested).toEqual([]);
  });

  it("sends to the league as the owner once the send mode is live", async () => {
    const espnFetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ status: "EXECUTED" })
    );
    vi.stubGlobal("fetch", espnFetch);
    const client = createWorkerWriteClient(
      loadServerEnv({ ...liveEspn, ESPN_SEND_MODE: "live", SEASON_YEAR: "2027" })
    );

    const result = await client?.applyLineup(lineupWrite, guard);

    expect(result).toMatchObject({ outcome: "sent", body: { memberId: liveEspn.ESPN_SWID } });
    expect(espnFetch).toHaveBeenCalledTimes(1);
    const [url, init] = espnFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/seasons/2027/segments/0/leagues/4567123/transactions/");
    expect(new Headers(init?.headers).get("cookie")).toBe(
      `espn_s2=${liveEspn.ESPN_S2}; SWID=${liveEspn.ESPN_SWID}`
    );
  });
});

describe("workerSendMode", () => {
  it("is live only for a worker that sends: live ESPN with the send mode live", () => {
    expect(workerSendMode(loadServerEnv({ ...liveEspn, ESPN_SEND_MODE: "live" }))).toBe("live");
  });

  it.each([
    liveEspn,
    { ESPN_MODE: "stub" },
    { ESPN_MODE: "scripted", ESPN_SCENARIO: "one-out-starter" },
    { ESPN_MODE: "none" },
  ])("is never for a worker that sends nothing ($ESPN_MODE)", (espn) => {
    expect(workerSendMode(loadServerEnv(espn))).toBe("never");
  });
});
