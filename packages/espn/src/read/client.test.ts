import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadClient } from "./client";
import type { EspnReadClient } from "./contracts";
import { CREDENTIAL_VIEWS } from "./credentials";
import { DAY_VIEWS } from "./day";
import { EspnError } from "./errors";
import { LINEUP_VIEWS } from "./league";
import { loadCommittedRecordings } from "./recordings";
import { RULES_VIEWS } from "./rules";
import { createLiveSource, requestKey } from "./source";
import { WEEK_VIEWS } from "./week";

// The live reads, over a fake ESPN that answers from the committed recordings: the real league,
// recorded on its day 8, with day 7 complete. The league id and cookies are made up.
const leagueId = 4567123;
const credentials = {
  espnS2: "AEBsyntheticCookie%3D",
  swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
};
const teamId = 3;
const completeDay = 7;

const espnFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  espnFetch.mockReset();
  vi.stubGlobal("fetch", espnFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A live request's key in the recordings, from its URL: league or NBA schedule, views, and day.
function recordedKeyOf(url: URL): string {
  const day = url.searchParams.get("scoringPeriodId");
  return requestKey({
    kind: url.pathname.includes("/leagues/") ? "league" : "pro-schedule",
    views: url.searchParams.getAll("view"),
    ...(day === null ? {} : { scoringPeriodId: Number(day) }),
  });
}

// Settles after delayMs, unless the request's signal aborts first, as a real fetch would.
function settleAfter(delayMs: number, signal: AbortSignal | null | undefined, response: Response) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(response), delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

// ESPN answers the game root at once, and each league and NBA-schedule request from the
// recordings after delayMs. The request whose key is `failing` gets a 503.
async function serveRecordings(options: { delayMs?: number; failing?: string } = {}) {
  const { responses } = await loadCommittedRecordings();
  espnFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/games/fba")) return Response.json({ currentSeasonId: 2027 });
    const key = recordedKeyOf(url);
    if (key !== options.failing && !responses.has(key)) {
      throw new Error(`the recordings don't hold ${key}`);
    }
    const response =
      key === options.failing
        ? Response.json({}, { status: 503 })
        : Response.json(responses.get(key));
    return settleAfter(options.delayMs ?? 0, init?.signal, response);
  });
}

function liveReads(timeoutMs?: number): EspnReadClient {
  return createReadClient(createLiveSource({ season: 2027, leagueId, credentials }), {
    timeoutMs,
    ownerSwid: credentials.swid,
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

type Read = (reads: EspnReadClient) => Promise<unknown>;

describe("a read's deadline", () => {
  // Each request takes 200 ms, under a 300 ms deadline for the read: any one request fits, but
  // these reads make several, so each runs out of time partway and fails as a whole.
  it.each<[string, Read]>([
    ["the current week", (reads) => reads.getCurrentWeek()],
    ["the rules check", (reads) => reads.checkLeagueRules()],
    ["a team's player outlook", (reads) => reads.getPlayerOutlook(teamId)],
  ])("times out %s as a whole, though each of its requests fits alone", async (_, read) => {
    await serveRecordings({ delayMs: 200 });

    const failure = await readFailure(read(liveReads(300)));

    expect(failure.code).toBe("espn_unavailable");
    expect(failure.message).toMatch(/^ESPN unavailable: timed out reading /);
  });
});

// The name after "reading" in a read's failure, when its own request gets a 503.
async function failedReadName(views: readonly string[], read: Read, scoringPeriodId?: number) {
  await serveRecordings({
    failing: requestKey({
      kind: "league",
      views,
      ...(scoringPeriodId === undefined ? {} : { scoringPeriodId }),
    }),
  });
  const failure = await readFailure(read(liveReads()));
  expect(failure).toMatchObject({ code: "espn_unavailable", status: 503 });
  return failure.message.match(/HTTP 503 reading (.*)$/)?.[1] ?? "";
}

describe("a failed read's message", () => {
  // A failure's message reaches the logs, so it names the read that failed. The outlook's own
  // request is its lineup request.
  it("names the read, its team and day where it has them, and no two reads alike", async () => {
    const names = {
      lineups: await failedReadName(LINEUP_VIEWS, (reads) => reads.getLineups()),
      lineup: await failedReadName(LINEUP_VIEWS, (reads) => reads.getLineup(teamId)),
      week: await failedReadName(WEEK_VIEWS, (reads) => reads.getCurrentWeek()),
      day: await failedReadName(
        DAY_VIEWS,
        (reads) => reads.getTeamDay(teamId, completeDay),
        completeDay
      ),
      credentials: await failedReadName(CREDENTIAL_VIEWS, (reads) => reads.checkCredentials()),
      rules: await failedReadName(RULES_VIEWS, (reads) => reads.checkLeagueRules()),
      outlook: await failedReadName(LINEUP_VIEWS, (reads) => reads.getPlayerOutlook(teamId)),
    };

    const all = Object.values(names);
    expect(all.filter((name) => name.trim() === "")).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
    const ofTeam = expect.stringMatching(new RegExp(`\\bteam ${teamId}\\b`));
    expect([names.lineup, names.day, names.outlook]).toEqual([ofTeam, ofTeam, ofTeam]);
    expect(names.day).toMatch(new RegExp(`\\bscoring period ${completeDay}\\b`));
  });
});
