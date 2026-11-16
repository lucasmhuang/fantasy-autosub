import { loadServerEnv } from "@injurysub/config";
import { type EspnClient, EspnError, type LineupWrite, type WriteGuard } from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerEspn, workerSendMode } from "./espn-client";
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

describe("createWorkerEspn's reads", () => {
  it("refuses every read without credentials in none mode, sending nothing", async () => {
    const requested = recordRequests();
    const { read: client } = await createWorkerEspn(loadServerEnv({ ESPN_MODE: "none" }));

    expect(client.mode).toBe("none");
    expect(await rejectionOf(client.getTeamWeek(1))).toMatchObject({ code: "not_connected" });
    expect(requested).toEqual([]);
  });

  it("reads the named scenario in scripted mode, sending nothing", async () => {
    const requested = recordRequests();
    const { read: client } = await createWorkerEspn(
      loadServerEnv({ ESPN_MODE: "scripted", ESPN_SCENARIO: "credentials-rejected" })
    );

    expect(client.mode).toBe("scripted");
    const failure = await rejectionOf(client.getTeamWeek(1));
    expect(failure).toBeInstanceOf(EspnError);
    expect(failure).toMatchObject({ code: "credentials_rejected" });
    expect(requested).toEqual([]);
  });

  it.each([
    "scripted",
    "practice",
  ])("refuses a scenario that doesn't exist, naming the setting and not the value (%s)", async (mode) => {
    const failure = await rejectionOf(
      createWorkerEspn(loadServerEnv({ ESPN_MODE: mode, ESPN_SCENARIO: "no-such-scenario" }))
    );

    expect(failure).toBeInstanceOf(WorkerStartupError);
    expect(failure).toMatchObject({ message: expect.stringMatching(/ESPN_SCENARIO/) });
    expect(String(failure)).not.toMatch(/no-such-scenario/);
  });

  it("reads the committed recordings in stub mode", async () => {
    expect((await createWorkerEspn(loadServerEnv({}))).read.mode).toBe("stub");
  });

  it("reads live ESPN in live mode", async () => {
    const env = loadServerEnv({
      ESPN_MODE: "live",
      ESPN_S2: "s2",
      ESPN_SWID: "{swid}",
      LEAGUE_ID: "1",
    });

    expect((await createWorkerEspn(env)).read.mode).toBe("live");
  });

  it("reads a practice copy seeded from the named scenario, or from the recordings", async () => {
    const requested = recordRequests();
    const scenario = await createWorkerEspn(
      loadServerEnv({ ESPN_MODE: "practice", ESPN_SCENARIO: "one-out-starter" })
    );
    const recordings = await createWorkerEspn(loadServerEnv({ ESPN_MODE: "practice" }));

    expect(await designationOf(scenario.read, SCENARIO_GUARD)).toBe("OUT");
    expect(await designationOf(recordings.read, SCENARIO_GUARD)).not.toBe("OUT");
    expect(requested).toEqual([]);
  });
});

// one-out-starter's change to the recordings: team 1's starting guard is OUT.
const SCENARIO_GUARD = 6606;

async function designationOf(read: EspnClient, playerId: number) {
  const { team } = await read.getLineup(1);
  const players = [...team.starters, ...team.bench, ...team.injuredReserve].map((s) => s.player);
  return players.find((player) => player?.playerId === playerId)?.designation.status;
}

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

describe("createWorkerEspn's writes", () => {
  it("builds no write client in none mode", async () => {
    expect((await createWorkerEspn(loadServerEnv({ ESPN_MODE: "none" }))).write).toBe(null);
  });

  it.each([
    { ESPN_MODE: "stub" },
    { ESPN_MODE: "scripted", ESPN_SCENARIO: "one-out-starter" },
    liveEspn,
  ])("records each write without sending it while the send mode is never ($ESPN_MODE)", async (espn) => {
    const requested = recordRequests();
    const { write: client } = await createWorkerEspn(loadServerEnv(espn));

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
    const { write: client } = await createWorkerEspn(
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

  it("in practice, sends each write to the fake copy alone, with the rehearsal cookie and league 0", async () => {
    const requested = recordRequests();
    const espn = await createWorkerEspn(loadServerEnv({ ESPN_MODE: "practice" }));
    const practice = espn.practice;
    if (practice === null) throw new Error("practice mode built no fake ESPN");
    const sent: { url: string; cookie: string | null }[] = [];
    practice.routeWrites(async (input, init) => {
      sent.push({ url: String(input), cookie: new Headers(init?.headers).get("cookie") });
      return practice.fetch(input, init);
    });

    const result = await espn.write?.applyLineup(practiceSwap, guard);

    expect(result).toMatchObject({ outcome: "sent", answer: { status: "EXECUTED" } });
    expect(sent).toEqual([
      {
        url: "https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/0/transactions/",
        cookie: "espn_s2=rehearsal-only; SWID={00000000-0000-4000-8000-000000000000}",
      },
    ]);
    expect([await slotOf(espn.read, TOWNS), await slotOf(espn.read, SHARPE)]).toEqual(["BE", "C"]);
    expect(requested).toEqual([]);
  });
});

// Team 1 in the recordings (ESPN's day 8): Towns at C, Sharpe on the bench and C-eligible.
const TOWNS = 3136195;
const SHARPE = 4432194;
const practiceSwap: LineupWrite = {
  teamId: 1,
  scoringPeriodId: 8,
  moves: [
    { playerId: TOWNS, fromSlot: "C", toSlot: "BE" },
    { playerId: SHARPE, fromSlot: "BE", toSlot: "C" },
  ],
};

async function slotOf(read: EspnClient, playerId: number) {
  const { team } = await read.getLineup(1);
  const slots = [...team.starters, ...team.bench, ...team.injuredReserve];
  return slots.find((slot) => slot.player?.playerId === playerId)?.slot;
}

describe("workerSendMode", () => {
  it("is live only for a worker that sends: live ESPN with the send mode live", () => {
    expect(workerSendMode(loadServerEnv({ ...liveEspn, ESPN_SEND_MODE: "live" }))).toBe("live");
  });

  it("is practice for a worker that sends to its practice copy of ESPN", () => {
    expect(workerSendMode(loadServerEnv({ ESPN_MODE: "practice" }))).toBe("practice");
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
