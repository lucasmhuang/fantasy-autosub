import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEspnClient, createEspnReadClient } from "./client";
import type { EspnReadClient, ReadMeta } from "./read/contracts";
import { loadRecordingCapturedAt } from "./read/recordings";

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

  // A live read gives up after 10 seconds. AbortSignal.timeout is the platform's timer, which
  // fake timers don't drive, so the test checks the deadline the read asks it for.
  it("gives each live read a 10-second deadline", async () => {
    serveTeams({ id: 1, owners: [liveOptions.espnSwid], watchList: [3001] });
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await createEspnClient(liveOptions).checkCredentials();

    expect(timeout.mock.calls).toEqual([[10_000]]);
  });

  // A change on ESPN shows in the next live read, so no live read answers from a stored copy.
  // Only the season check's answer is kept.
  it("asks ESPN again for every live read", async () => {
    serveTeams({ id: 1, owners: [liveOptions.espnSwid], watchList: [3001] });
    const client = createEspnClient(liveOptions);

    await client.checkCredentials();
    await client.checkCredentials();

    const leagueRequests = espnFetch.mock.calls.filter(
      ([input]) => !new URL(String(input)).pathname.endsWith("/games/fba")
    );
    expect(leagueRequests).toHaveLength(2);
  });

  it("checks the credentials live, asking ESPN for the teams alone, with the cookies", async () => {
    serveTeams({ id: 1, owners: [liveOptions.espnSwid], watchList: [3001] });

    const check = await createEspnClient(liveOptions).checkCredentials();

    expect(check).toEqual({ ok: true, source: "live" });
    const [teamsUrl, init] =
      espnFetch.mock.calls.find(
        ([input]) => !new URL(String(input)).pathname.endsWith("/games/fba")
      ) ?? [];
    expect(new URL(String(teamsUrl)).searchParams.getAll("view")).toEqual(["mTeam"]);
    expect(new Headers(init?.headers).get("Cookie")).toContain(liveOptions.espnS2);
  });

  it("rejects live cookies that aren't the owner's, naming neither the cookie nor the member", async () => {
    serveTeams({ id: 1, owners: [liveOptions.espnSwid] });

    const failure = await createEspnClient(liveOptions)
      .checkCredentials()
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "credentials_rejected" });
    expect(failure).toHaveProperty("message", expect.not.stringContaining(liveOptions.espnS2));
    expect(failure).toHaveProperty("message", expect.not.stringContaining("A1B2C3D4"));
  });
});

// ESPN's answers to a live credential check: the game root, then the teams request.
function serveTeams(ownerTeam: Record<string, unknown>) {
  espnFetch.mockImplementation(async (input) =>
    new URL(String(input)).pathname.endsWith("/games/fba")
      ? Response.json({ currentSeasonId: 2027 })
      : Response.json({ teams: [ownerTeam] })
  );
}

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

// Every read a client offers but the credential check, which carries no meta: the lineups, one
// team's lineup, the week, that team's day on each of the recorded week's complete days and today,
// the rules check, and that team's player outlook.
async function readEveryRead(client: EspnReadClient) {
  const lineups = await client.getLineups();
  const teamId = lineups.teams[0]?.teamId;
  if (teamId === undefined) throw new Error("the recording has no team");
  const currentWeek = await client.getCurrentWeek();
  const { completeScoringPeriodIds, todayScoringPeriodId } = currentWeek.week;
  const days = await Promise.all(
    [...completeScoringPeriodIds, todayScoringPeriodId].map((day) => client.getTeamDay(teamId, day))
  );
  return [
    lineups,
    await client.getLineup(teamId),
    currentWeek,
    ...days,
    await client.checkLeagueRules(),
    await client.getPlayerOutlook(teamId),
  ];
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

  it("names, for the worker's start log, the capture time every recorded answer carries", async () => {
    const recordedAt = await loadRecordingCapturedAt();
    const answers = await readEveryRead(createEspnClient({ mode: "stub" }));

    expect(Date.parse(recordedAt)).not.toBeNaN();
    expect(answers.map((answer) => answer.meta.capturedAt)).toEqual(answers.map(() => recordedAt));
  });

  it("confirms the credentials without contacting ESPN, since the recorded league needs none", async () => {
    await expect(createEspnClient({ mode: "stub" }).checkCredentials()).resolves.toEqual({
      ok: true,
      source: "recorded",
    });
  });
});
