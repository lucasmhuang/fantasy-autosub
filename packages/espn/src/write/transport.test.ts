import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EspnError } from "../read/errors";
import type { EspnCredentials } from "../read/request";
import { createWriteDeadline, type EspnWriteRequest, postEspnJson } from "./transport";

// Synthetic values: the real league id and cookies never appear in tests.
const leagueId = 4567123;
const credentials: EspnCredentials = {
  espnS2: "AEBsyntheticCookieValue%2Bfor%2Btests%3D",
  swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
};
const lineupBody = { teamId: 1, type: "ROSTER", items: [] };

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

function answerText(status: number, text: string) {
  espnFetch.mockImplementation(async () => new Response(text, { status }));
}

// A failed connection as Node's fetch reports it: a TypeError whose cause carries the socket's
// code (spiked 2026-11-13: ECONNREFUSED and ENOTFOUND before sending; UND_ERR_SOCKET and
// ECONNRESET for a connection dropped after the request went out).
function failConnection(code: string) {
  espnFetch.mockImplementation(async () => {
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error(`socket failure ${code}`), { code }),
    });
  });
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

function writeLineup(overrides: Partial<EspnWriteRequest> = {}) {
  return postEspnJson({
    season: 2027,
    leagueId,
    path: "transactions/",
    writeName: "the lineup for team 1",
    body: lineupBody,
    credentials,
    signal: createWriteDeadline(),
    ...overrides,
  });
}

async function writeFailure(write: Promise<unknown>): Promise<EspnError> {
  try {
    await write;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the write to fail");
}

describe("postEspnJson", () => {
  it("returns ESPN's parsed answer to a write it accepted", async () => {
    answer(200, { id: "a-transaction", status: "EXECUTED" });

    await expect(writeLineup()).resolves.toEqual({ id: "a-transaction", status: "EXECUTED" });
  });

  it("posts the body as JSON to the league's path on ESPN's write host, with the headers ESPN's own page sends", async () => {
    answer(200, {});

    await writeLineup();

    expect(espnFetch).toHaveBeenCalledTimes(1);
    const [url, init] = espnFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/${leagueId}/transactions/`
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(lineupBody));
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: `espn_s2=${credentials.espnS2}; SWID=${credentials.swid}`,
      "X-Fantasy-Source": "kona",
      "X-Fantasy-Platform": "espn-fantasy-web",
    });
  });

  it("names refused credentials on a 401", async () => {
    answer(401, { details: [{ type: "AUTH_LEAGUE_NOT_VISIBLE" }] });

    expect(await writeFailure(writeLineup())).toMatchObject({
      code: "credentials_rejected",
      status: 401,
    });
  });

  it("names a refused write on a 400, keeping ESPN's error type out of the message and in the cause", async () => {
    answer(400, { messages: ["Invalid"], details: [{ type: "TRAN_LINEUP_INVALID" }] });

    const error = await writeFailure(writeLineup());

    expect(error).toMatchObject({ code: "write_refused", status: 400 });
    expect(error.message).not.toContain("TRAN_LINEUP_INVALID");
    expect(error.cause).toMatchObject({ message: "HTTP 400 TRAN_LINEUP_INVALID" });
  });

  it("names a league ESPN doesn't have on a 404", async () => {
    answer(404, { details: [{ type: "GENERAL_NOT_FOUND" }] });

    expect(await writeFailure(writeLineup())).toMatchObject({
      code: "league_not_found",
      status: 404,
    });
  });

  it.each([
    503, 429,
  ])("calls ESPN unavailable when it declines the write with a %i", async (status) => {
    answer(status, {});

    expect(await writeFailure(writeLineup())).toMatchObject({
      code: "espn_unavailable",
      status,
    });
  });

  it.each([
    500, 502, 504,
  ])("can't tell whether a write ESPN answered with a %i applied", async (status) => {
    answer(status, {});

    expect(await writeFailure(writeLineup())).toMatchObject({ code: "outcome_unknown", status });
  });

  it("can't tell whether a write cut off by its deadline applied", async () => {
    answerAfter(200);

    const error = await writeFailure(writeLineup({ signal: createWriteDeadline(50) }));

    expect(error.code).toBe("outcome_unknown");
  });

  it.each([
    "ECONNREFUSED",
    "ENOTFOUND",
  ])("calls ESPN unavailable when a write never left this machine (%s)", async (code) => {
    failConnection(code);

    const error = await writeFailure(writeLineup());

    expect(error.code).toBe("espn_unavailable");
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it.each([
    "UND_ERR_SOCKET",
    "ECONNRESET",
  ])("can't tell whether a write whose connection dropped applied (%s)", async (code) => {
    failConnection(code);

    expect((await writeFailure(writeLineup())).code).toBe("outcome_unknown");
  });

  it("can't tell whether a write applied when ESPN accepted it with an answer that isn't JSON", async () => {
    answerText(200, '{"partial":');

    expect((await writeFailure(writeLineup())).code).toBe("outcome_unknown");
  });

  it("refuses credentials a cookie can't carry before sending anything", async () => {
    answer(200, {});

    const error = await writeFailure(
      writeLineup({ credentials: { ...credentials, espnS2: "has a space" } })
    );

    expect(error.code).toBe("credentials_rejected");
    expect(error.message).not.toContain("has a space");
    expect(espnFetch).not.toHaveBeenCalled();
  });

  it("never names the league id or a cookie in a failure's message", async () => {
    const failures: EspnError[] = [];
    for (const status of [400, 401, 404, 429, 500, 503]) {
      answer(status, { details: [{ type: "GENERAL_ERROR" }] });
      failures.push(await writeFailure(writeLineup()));
    }
    for (const code of ["ECONNREFUSED", "UND_ERR_SOCKET"]) {
      failConnection(code);
      failures.push(await writeFailure(writeLineup()));
    }
    answerAfter(200);
    failures.push(await writeFailure(writeLineup({ signal: createWriteDeadline(50) })));

    for (const failure of failures) {
      expect(failure.message).not.toContain(String(leagueId));
      expect(failure.message).not.toContain(credentials.espnS2);
      expect(failure.message).toContain("the lineup for team 1");
    }
  });
});
