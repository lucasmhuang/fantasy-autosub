import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEspnClient, createEspnReadClient } from "./client";
import type { EspnReadClient, ReadMeta } from "./read/contracts";

const YEAR_MS = 365 * 86_400_000;

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

  it("keeps the league id out of the live writes' errors", async () => {
    const client = createEspnClient(liveOptions);
    const withoutLeagueId = expect.not.stringContaining(String(liveOptions.leagueId));

    await expect(
      client.applyRosterStep({ type: "swap", description: "bench to C" })
    ).rejects.toHaveProperty("message", withoutLeagueId);
    await expect(client.applyScoreAdjustment(3, 41, -12.5)).rejects.toHaveProperty(
      "message",
      withoutLeagueId
    );
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

describe("createEspnReadClient", () => {
  it("builds in either mode without contacting ESPN", () => {
    expect(createEspnReadClient({ mode: "stub" }).mode).toBe("stub");
    expect(createEspnReadClient(liveOptions).mode).toBe("live");
    expect(espnFetch).not.toHaveBeenCalled();
  });

  it("has no writes, so code that holds it can't write to ESPN", () => {
    const client = createEspnReadClient(liveOptions);

    // @ts-expect-error The read-only client has no applyRosterStep: only the worker writes.
    expect(client.applyRosterStep).toBeUndefined();
    // @ts-expect-error The read-only client has no applyScoreAdjustment: only the worker writes.
    expect(client.applyScoreAdjustment).toBeUndefined();
  });
});

// Every read a client offers: the lineups, one team's lineup, the week, and that team's day on each
// of the recorded week's complete days and today.
async function readEveryRead(client: EspnReadClient) {
  const lineups = await client.getLineups();
  const teamId = lineups.teams[0]?.teamId;
  if (teamId === undefined) throw new Error("the recording has no team");
  const currentWeek = await client.getCurrentWeek();
  const { completeScoringPeriodIds, todayScoringPeriodId } = currentWeek.week;
  const days = await Promise.all(
    [...completeScoringPeriodIds, todayScoringPeriodId].map((day) => client.getTeamDay(teamId, day))
  );
  return [lineups, await client.getLineup(teamId), currentWeek, ...days];
}

// Answers as they compare across clients and clocks: everything but the read time.
function ignoringReadTime(answers: readonly { meta: ReadMeta }[]) {
  return answers.map((answer) => ({
    ...answer,
    meta: { ...answer.meta, readAt: expect.any(String) },
  }));
}

describe("stub mode, with the network guard on", () => {
  beforeEach(() => {
    // The fetch fake gives way to the network guard (vitest.setup.ts): a live request would fail.
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers every read from the recorded league", async () => {
    const answers = await readEveryRead(createEspnClient({ mode: "stub" }));
    const capturedAt = answers[0]?.meta.capturedAt;

    expect(capturedAt).toEqual(expect.any(String));
    for (const answer of answers) {
      expect(answer.meta).toMatchObject({ source: "recorded", capturedAt });
    }
  });

  it("answers the same a year after the capture", async () => {
    const answers = await readEveryRead(createEspnClient({ mode: "stub" }));
    const capturedAt = answers[0]?.meta.capturedAt;
    if (capturedAt === undefined) throw new Error("the recorded answers carry no capture time");
    const yearLater = new Date(Date.parse(capturedAt) + YEAR_MS);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(yearLater);
    const laterAnswers = await readEveryRead(createEspnClient({ mode: "stub" }));

    // Only the read time follows the clock.
    expect(laterAnswers.map((answer) => answer.meta.readAt)).toEqual(
      answers.map(() => yearLater.toISOString())
    );
    expect(laterAnswers).toEqual(ignoringReadTime(answers));
  });

  it("gives the same recorded answers through the read-only client", async () => {
    const answers = await readEveryRead(createEspnClient({ mode: "stub" }));
    const readOnlyAnswers = await readEveryRead(createEspnReadClient({ mode: "stub" }));

    expect(readOnlyAnswers).toEqual(ignoringReadTime(answers));
  });
});
