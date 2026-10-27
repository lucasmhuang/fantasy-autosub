import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EspnError } from "./errors";
import {
  createReadDeadline,
  type EspnCredentials,
  gameRootUrl,
  leagueViewUrl,
  proScheduleUrl,
  readEspnJson,
} from "./request";

// Synthetic values: the real league id and cookies never appear in tests.
const leagueId = 4567123;
const credentials: EspnCredentials = {
  espnS2: "AEBsyntheticCookieValue%2Bfor%2Btests%3D",
  swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
};

// ESPN's error bodies as the 2026-10-24 probe saw them, on the private league.
const notAuthorizedBody = {
  messages: ["You are not authorized to view this League."],
  details: [
    { message: "You are not authorized to view this League.", type: "AUTH_LEAGUE_NOT_VISIBLE" },
  ],
};
const notFoundBody = {
  messages: ["Not Found"],
  details: [{ message: "Not Found", type: "GENERAL_NOT_FOUND" }],
};

const espnFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  espnFetch.mockReset();
  vi.stubGlobal("fetch", espnFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, body: unknown) {
  espnFetch.mockImplementation(async () => Response.json(body, { status }));
}

// Answers after `ms`, unless the request's signal aborts first, as a real fetch would.
function answerAfter(ms: number) {
  espnFetch.mockImplementation(
    (_input, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ answered: true })), ms);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          },
          { once: true }
        );
      })
  );
}

function readLeague(
  options: { credentials?: EspnCredentials; scoringPeriodId?: number; signal?: AbortSignal } = {}
) {
  return readEspnJson({
    url: leagueViewUrl(2027, leagueId, ["mRoster", "mTeam"], options.scoringPeriodId),
    readName: "league views mRoster, mTeam",
    season: 2027,
    signal: options.signal ?? createReadDeadline(),
    credentials: options.credentials,
  });
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

// A failure's message reaches logs and, later, the commissioner's screen.
function expectNoSecrets(error: EspnError) {
  expect(error.message).not.toContain(String(leagueId));
  expect(error.message).not.toContain(credentials.espnS2);
  expect(error.message).not.toContain(credentials.swid);
  expect(error.cause).toBeInstanceOf(Error);
}

describe("ESPN read URLs", () => {
  // These are ESPN's own paths and parameters, as the read-only probes used them.
  it("builds the league, season and game URLs that ESPN serves", () => {
    const league = new URL(leagueViewUrl(2027, leagueId, ["mMatchupScore", "mMatchup"], 5));

    expect(`${league.origin}${league.pathname}`).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/4567123"
    );
    expect(league.searchParams.getAll("view")).toEqual(["mMatchupScore", "mMatchup"]);
    expect(league.searchParams.get("scoringPeriodId")).toBe("5");
    expect(
      new URL(leagueViewUrl(2027, leagueId, ["mTeam"])).searchParams.has("scoringPeriodId")
    ).toBe(false);
    expect(proScheduleUrl(2027)).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027?view=proTeamSchedules_wl"
    );
    expect(gameRootUrl()).toBe("https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba");
  });
});

describe("readEspnJson", () => {
  it("sends one GET per call, with the cookies only when credentials are given", async () => {
    answer(200, { seasonId: 2027 });

    await readLeague({ credentials, scoringPeriodId: 5 });
    await readLeague();

    expect(espnFetch).toHaveBeenCalledTimes(2);
    const [withCredentials, withoutCredentials] = espnFetch.mock.calls;
    const sent = new URL(String(withCredentials?.[0]));
    expect(sent.searchParams.getAll("view")).toEqual(["mRoster", "mTeam"]);
    expect(sent.searchParams.get("scoringPeriodId")).toBe("5");
    expect(withCredentials?.[1]?.method ?? "GET").toBe("GET");
    const headers = new Headers(withCredentials?.[1]?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("cookie")).toBe(`espn_s2=${credentials.espnS2}; SWID=${credentials.swid}`);
    expect(new Headers(withoutCredentials?.[1]?.headers).has("cookie")).toBe(false);
  });

  // fetch refuses a header holding a line break with an error that quotes the whole header, the
  // cookies included (Node 24, checked 2026-10-27), so the read refuses such credentials first.
  it.each([
    ["a line break in espn_s2", { espnS2: `${credentials.espnS2}\nX`, swid: credentials.swid }],
    ["a space in the SWID", { espnS2: credentials.espnS2, swid: ` ${credentials.swid}` }],
    ["a semicolon in espn_s2", { espnS2: `${credentials.espnS2};X`, swid: credentials.swid }],
  ])("refuses credentials with %s before any request, naming neither", async (_, unsafe) => {
    const error = await readFailure(readLeague({ credentials: unsafe }));

    expect(error.code).toBe("credentials_rejected");
    expect(error.cause).toBeUndefined();
    expect(espnFetch).not.toHaveBeenCalled();
    expect(error.message).not.toContain(credentials.espnS2);
    expect(error.message).not.toContain(credentials.swid);
  });

  it("returns the parsed body of a successful read", async () => {
    answer(200, { seasonId: 2027 });

    await expect(readLeague()).resolves.toEqual({ seasonId: 2027 });
  });

  it("reports a 401 as credentials that need refreshing, naming both causes", async () => {
    answer(401, notAuthorizedBody);

    const error = await readFailure(readLeague({ credentials }));

    expect(error).toMatchObject({ code: "credentials_rejected", status: 401 });
    expect(error.message).toMatch(/credentials need refreshing/);
    expect(error.message).toMatch(/LEAGUE_ID/);
    expect(error.cause).toMatchObject({ message: "HTTP 401 AUTH_LEAGUE_NOT_VISIBLE" });
    expectNoSecrets(error);
  });

  it("reports a 404 as a league that wasn't found, naming the season", async () => {
    answer(404, notFoundBody);

    const error = await readFailure(readLeague());

    expect(error).toMatchObject({ code: "league_not_found", status: 404 });
    expect(error.message).toMatch(/season 2027/);
    expect(error.cause).toMatchObject({ message: "HTTP 404 GENERAL_NOT_FOUND" });
    expectNoSecrets(error);
  });

  it.each([403, 429, 500])("reports HTTP %i as ESPN being unavailable", async (status) => {
    answer(status, { messages: ["Something went wrong"] });

    const error = await readFailure(readLeague());

    expect(error).toMatchObject({ code: "espn_unavailable", status });
    expect(error.message).toMatch(/ESPN unavailable/);
    expectNoSecrets(error);
  });

  it("reports a failed connection as ESPN being unavailable, keeping the fetch error", async () => {
    const failure = new TypeError("fetch failed");
    espnFetch.mockRejectedValue(failure);

    const error = await readFailure(readLeague());

    expect(error).toMatchObject({ code: "espn_unavailable" });
    expect(error.cause).toBe(failure);
    expectNoSecrets(error);
  });

  it("reports a body that isn't JSON as an unrecognized response", async () => {
    espnFetch.mockImplementation(async () => new Response("<html>maintenance</html>"));

    const error = await readFailure(readLeague());

    expect(error).toMatchObject({ code: "unrecognized_response", status: 200 });
    expectNoSecrets(error);
  });

  it("gives a whole read one deadline, shared by all of its requests", async () => {
    answerAfter(200);
    const deadline = createReadDeadline(300);

    await expect(readLeague({ signal: deadline })).resolves.toEqual({ answered: true });
    const error = await readFailure(readLeague({ signal: deadline }));

    expect(error).toMatchObject({ code: "espn_unavailable" });
    expect(error.message).toBe("ESPN unavailable: timed out reading league views mRoster, mTeam");
    expectNoSecrets(error);
  });
});
