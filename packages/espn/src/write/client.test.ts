import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Matchup } from "../read/contracts";
import { EspnError } from "../read/errors";
import { createEspnWriteClient } from "./client";
import type { AdjustmentWrite, EspnSendMode, LineupWrite, WriteGuard } from "./contracts";

// Synthetic values: the real league id and cookies never appear in tests.
const leagueId = 4567123;
const credentials = {
  espnS2: "AEBsyntheticCookieValue%2Bfor%2Btests%3D",
  swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
};

const lineupWrite: LineupWrite = {
  teamId: 1,
  scoringPeriodId: 25,
  moves: [
    { playerId: 101, fromSlot: "C", toSlot: "BE" },
    { playerId: 103, fromSlot: "BE", toSlot: "C" },
  ],
};

const matchup: Matchup = {
  matchupId: 40,
  home: { teamId: 1, score: 900, adjustment: 0, adjustmentReason: null, creditedPlayers: [] },
  away: { teamId: 6, score: 950, adjustment: 1.2, adjustmentReason: "x", creditedPlayers: [] },
};
const adjustmentWrite: AdjustmentWrite = { matchup, teamId: 1, targetTenths: 51, reason: "r" };

const espnFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  espnFetch.mockReset();
  espnFetch.mockImplementation(async () => Response.json({ status: "EXECUTED" }));
  vi.stubGlobal("fetch", espnFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function writeClient(sendMode: EspnSendMode) {
  return createEspnWriteClient({ sendMode, credentials, leagueId, season: 2027 });
}

// Records what happened, in order: each pre-send step's body, then each request ESPN received.
function recordingGuard(allowlist: number[], events: string[]): WriteGuard {
  espnFetch.mockImplementation(async (input) => {
    events.push(`fetch ${new URL(String(input)).pathname.split("/").at(-1) || "transactions/"}`);
    return Response.json({ status: "EXECUTED" });
  });
  return {
    allowlist: new Set(allowlist),
    beforeSend: async (body) => {
      events.push(`beforeSend ${Array.isArray(body) ? "schedule" : "lineup"}`);
    },
  };
}

describe("createEspnWriteClient", () => {
  it("sends a lineup edit live, after its pre-send step has the exact body", async () => {
    const events: string[] = [];
    const guard = recordingGuard([1], events);
    const beforeSend = vi.spyOn(guard, "beforeSend");

    const result = await writeClient("live").applyLineup(lineupWrite, guard);

    expect(events).toEqual(["beforeSend lineup", "fetch transactions/"]);
    expect(result).toMatchObject({ outcome: "sent", answer: { status: "EXECUTED" } });
    expect(beforeSend).toHaveBeenCalledWith(result.body);
    const [url, init] = espnFetch.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/leagues\/4567123\/transactions\/$/);
    expect(JSON.parse(String(init?.body))).toEqual(result.body);
    expect(result.body).toMatchObject({
      teamId: 1,
      memberId: credentials.swid,
      scoringPeriodId: 25,
    });
  });

  it("sends an adjustment live to the league's schedule, after its pre-send step", async () => {
    const events: string[] = [];

    const result = await writeClient("live").applyAdjustment(
      adjustmentWrite,
      recordingGuard([1], events)
    );

    expect(events).toEqual(["beforeSend schedule", "fetch schedule"]);
    expect(result.outcome).toBe("sent");
    expect(JSON.parse(String(espnFetch.mock.calls[0]?.[1]?.body))).toEqual(result.body);
  });

  it("records each write without sending it in never mode", async () => {
    const events: string[] = [];
    const guard = recordingGuard([1], events);
    const client = writeClient("never");

    const lineup = await client.applyLineup(lineupWrite, guard);
    const adjustment = await client.applyAdjustment(adjustmentWrite, guard);

    expect(espnFetch).not.toHaveBeenCalled();
    expect(events).toEqual(["beforeSend lineup", "beforeSend schedule"]);
    expect(lineup).toMatchObject({ outcome: "recorded_only", body: { teamId: 1 } });
    expect(adjustment.outcome).toBe("recorded_only");
  });

  it.each([
    "live",
    "never",
  ] as const)("refuses a team off the allowlist before anything else, in %s mode", async (mode) => {
    const events: string[] = [];
    const guard = recordingGuard([1], events);
    const client = writeClient(mode);

    const lineup = client.applyLineup({ ...lineupWrite, teamId: 5 }, guard);
    const adjustment = client.applyAdjustment(
      {
        ...adjustmentWrite,
        teamId: 6,
      },
      guard
    );

    await expect(lineup).rejects.toMatchObject({ name: "EspnError", code: "team_not_allowed" });
    await expect(adjustment).rejects.toBeInstanceOf(EspnError);
    await expect(adjustment).rejects.toMatchObject({ code: "team_not_allowed" });
    expect(events).toEqual([]);
  });

  it("sends nothing when the pre-send step fails", async () => {
    const guard: WriteGuard = {
      allowlist: new Set([1]),
      beforeSend: async () => {
        throw new Error("the lease moved on");
      },
    };

    await expect(writeClient("live").applyLineup(lineupWrite, guard)).rejects.toThrow(
      "the lease moved on"
    );
    expect(espnFetch).not.toHaveBeenCalled();
  });
});
