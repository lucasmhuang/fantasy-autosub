import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEspnClient } from "./client";

const liveOptions = {
  mode: "live" as const,
  espnS2: "AEBsyntheticCookie%3D",
  espnSwid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
  leagueId: 4567123,
  seasonYear: 2027,
};

const espnFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  espnFetch.mockReset();
  vi.stubGlobal("fetch", espnFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createEspnClient", () => {
  it("builds either client without contacting ESPN", () => {
    expect(createEspnClient({ mode: "stub" }).mode).toBe("stub");
    expect(createEspnClient(liveOptions).mode).toBe("live");
    expect(espnFetch).not.toHaveBeenCalled();
  });

  it("keeps the stub's writes to one log line each, changing nothing", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => lines.push(String(line)));
    const client = createEspnClient({ mode: "stub" });

    await client.applyRosterStep({ type: "swap", description: "bench to C" });
    await client.applyScoreAdjustment(3, 41, -12.5);

    expect(lines.map((line) => JSON.parse(line))).toMatchObject([
      { service: "espn", mode: "stub", event: "applyRosterStep" },
      { service: "espn", mode: "stub", event: "applyScoreAdjustment", teamId: 3, matchupId: 41 },
    ]);
    expect(espnFetch).not.toHaveBeenCalled();
  });

  it("keeps live writes failing before any request", async () => {
    const client = createEspnClient(liveOptions);

    await expect(
      client.applyRosterStep({ type: "swap", description: "bench to C" })
    ).rejects.toThrow(/not implemented yet/);
    await expect(client.applyScoreAdjustment(3, 41, -12.5)).rejects.toThrow(/not implemented yet/);
    expect(espnFetch).not.toHaveBeenCalled();
  });

  it("reads lineups live from ESPN, labelled as live", async () => {
    espnFetch.mockImplementation(async (input) =>
      new URL(String(input)).pathname.endsWith("/games/fba")
        ? Response.json({ currentSeasonId: 2027 })
        : Response.json({
            seasonId: 2027,
            scoringPeriodId: 5,
            status: { currentMatchupPeriod: 1 },
            settings: { rosterSettings: { lineupSlotCounts: { "4": 1 } } },
            teams: [{ id: 1, name: "Team 1", roster: { entries: [] } }],
          })
    );

    const read = await createEspnClient(liveOptions).getLineups();

    expect(read.meta.source).toBe("live");
    expect(read.teams.map((team) => team.teamId)).toEqual([1]);
  });
});
