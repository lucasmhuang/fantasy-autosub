import { afterEach, describe, expect, it, vi } from "vitest";
import { probeEspnReachability } from "./reachability";

afterEach(() => {
  vi.unstubAllGlobals();
});

function answerWith(status: number, contentType: string, body: string) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requested.push(`${url} cookie=${new Headers(init?.headers).has("cookie")}`);
    return new Response(body, { status, headers: { "content-type": contentType } });
  });
  return requested;
}

describe("probeEspnReachability", () => {
  it("finds ESPN reachable when the league answers a JSON 401 without cookies", async () => {
    const requested = answerWith(401, "application/json;charset=UTF-8", '{"messages":[]}');

    const results = await probeEspnReachability({ season: 2027, leagueId: 12345 });

    expect(results).toEqual([
      {
        target: "game_root",
        result: "espn_reachable",
        status: 401,
        contentType: "application/json",
      },
      { target: "league", result: "espn_reachable", status: 401, contentType: "application/json" },
    ]);
    expect(requested.every((line) => line.endsWith("cookie=false"))).toBe(true);
  });

  it("finds a challenge page when ESPN answers HTML", async () => {
    answerWith(403, "text/html", "<html>challenge</html>");

    const [gameRoot] = await probeEspnReachability({ season: 2027 });

    expect(gameRoot).toEqual({
      target: "game_root",
      result: "espn_challenge",
      status: 403,
      contentType: "text/html",
    });
  });

  it("probes only the game root without a league id, and reports a failed connection", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    expect(await probeEspnReachability({ season: 2027 })).toEqual([
      { target: "game_root", result: "espn_unreachable", status: null, contentType: null },
    ]);
  });
});
