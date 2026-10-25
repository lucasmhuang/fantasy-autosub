import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EspnError } from "./errors";
import {
  createLiveSource,
  createRecordedSource,
  createRecordingSource,
  type EspnSource,
  type EspnSourceRequest,
  type Recordings,
  requestKey,
} from "./source";

const signal = new AbortController().signal;

function request(
  views: readonly string[],
  options: { kind?: EspnSourceRequest["kind"]; scoringPeriodId?: number } = {}
): EspnSourceRequest {
  return {
    kind: options.kind ?? "league",
    views,
    scoringPeriodId: options.scoringPeriodId,
    readName: "a test read",
    signal,
  };
}

async function readFailure(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

describe("requestKey", () => {
  // Committed recordings are keyed this way, so a change here must come with a recapture.
  it("names a request by kind, its views in sorted order, and its scoring period", () => {
    expect(requestKey(request(["mTeam", "mRoster"]))).toBe("league:mRoster,mTeam");
    expect(requestKey(request(["mRoster"], { scoringPeriodId: 5 }))).toBe("league:mRoster@5");
    expect(requestKey(request(["proTeamSchedules_wl"], { kind: "pro-schedule" }))).toBe(
      "pro-schedule:proTeamSchedules_wl"
    );
    expect(requestKey(request([], { kind: "game" }))).toBe("game");
  });
});

describe("createRecordedSource", () => {
  const recordings: Recordings = {
    capturedAt: "2026-10-25T01:00:00.000Z",
    season: 2027,
    responses: new Map([["league:mRoster,mTeam", { teams: [{ id: 1 }] }]]),
  };

  it("answers a recorded request with a copy of its body and the capture time", async () => {
    const source = createRecordedSource(async () => recordings);

    const first = await source(request(["mTeam", "mRoster"]));
    Reflect.set(Object(first.body), "teams", []);
    const second = await source(request(["mRoster", "mTeam"]));

    expect(second).toEqual({
      body: { teams: [{ id: 1 }] },
      capturedAt: "2026-10-25T01:00:00.000Z",
    });
  });

  it("refuses a request the recording doesn't hold, even one view short", async () => {
    const source = createRecordedSource(async () => recordings);

    const error = await readFailure(source(request(["mRoster"])));

    expect(error.code).toBe("not_recorded");
    expect(error.message).toMatch(/league:mRoster\b/);
  });
});

describe("createRecordingSource", () => {
  it("keeps each request, with its body, under its key, and passes the answer on", async () => {
    const inner: EspnSource = async (asked) => ({ body: { asked: requestKey(asked) } });
    const recording = createRecordingSource(inner);

    const answer = await recording.source(request(["mTeam", "mRoster"]));
    await recording.source(request(["mRoster"], { scoringPeriodId: 5 }));

    expect(answer).toEqual({ body: { asked: "league:mRoster,mTeam" } });
    expect([...recording.recorded()]).toEqual([
      [
        "league:mRoster,mTeam",
        { kind: "league", views: ["mTeam", "mRoster"], body: { asked: "league:mRoster,mTeam" } },
      ],
      [
        "league:mRoster@5",
        {
          kind: "league",
          views: ["mRoster"],
          scoringPeriodId: 5,
          body: { asked: "league:mRoster@5" },
        },
      ],
    ]);
  });
});

describe("createLiveSource", () => {
  const leagueId = 4567123;
  const credentials = {
    espnS2: "AEBsyntheticCookie%3D",
    swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
  };
  const espnFetch =
    vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

  // ESPN answers the game root with the season in progress, and a league URL with a body.
  function serve(currentSeasonId: number) {
    espnFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/games/fba")
        ? Response.json({ currentSeasonId })
        : Response.json({ servedPath: url.pathname, views: url.searchParams.getAll("view") });
    });
  }

  beforeEach(() => {
    espnFetch.mockReset();
    vi.stubGlobal("fetch", espnFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the season once, then reads league views with the credentials", async () => {
    serve(2027);
    const source = createLiveSource({ season: 2027, leagueId, credentials });

    const first = await source(request(["mRoster", "mTeam"], { scoringPeriodId: 5 }));
    await source(request(["mSettings"]));

    const urls = espnFetch.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.pathname)).toEqual([
      "/apis/v3/games/fba",
      "/apis/v3/games/fba/seasons/2027/segments/0/leagues/4567123",
      "/apis/v3/games/fba/seasons/2027/segments/0/leagues/4567123",
    ]);
    expect(urls[1]?.searchParams.get("scoringPeriodId")).toBe("5");
    expect(first).toEqual({
      body: {
        servedPath: "/apis/v3/games/fba/seasons/2027/segments/0/leagues/4567123",
        views: ["mRoster", "mTeam"],
      },
    });
    const leagueHeaders = new Headers(espnFetch.mock.calls[1]?.[1]?.headers);
    expect(leagueHeaders.get("cookie")).toBe(
      `espn_s2=${credentials.espnS2}; SWID=${credentials.swid}`
    );
  });

  it("refuses to read a season that isn't the one in progress, without asking ESPN for it", async () => {
    serve(2028);
    const source = createLiveSource({ season: 2027, leagueId, credentials });

    const error = await readFailure(source(request(["mRoster"])));

    expect(error.code).toBe("season_not_in_progress");
    expect(espnFetch).toHaveBeenCalledTimes(1);
  });

  it("reads the pro schedule for the configured season", async () => {
    serve(2027);
    const source = createLiveSource({ season: 2027, leagueId, credentials });

    const answer = await source(request(["proTeamSchedules_wl"], { kind: "pro-schedule" }));

    expect(answer.body).toEqual({
      servedPath: "/apis/v3/games/fba/seasons/2027",
      views: ["proTeamSchedules_wl"],
    });
  });
});
