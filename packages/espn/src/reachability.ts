import { gameRootUrl, leagueViewUrl } from "./read/request";

// What a cookie-less request to ESPN gets back, so a deployment without the cookie can show it
// reaches ESPN at all: JSON (a 401 for the private league) means ESPN answered; HTML means a
// challenge or block page stood in the way. Results name the target, never the URL (it holds the
// league id).
export type ReachabilityResult = {
  target: "game_root" | "league";
  result: "espn_reachable" | "espn_challenge" | "espn_unreachable";
  status: number | null;
  contentType: string | null;
};

const PROBE_TIMEOUT_MS = 10_000;

export async function probeEspnReachability(input: {
  season: number;
  leagueId?: number;
}): Promise<ReachabilityResult[]> {
  const targets: { target: ReachabilityResult["target"]; url: string }[] = [
    { target: "game_root", url: gameRootUrl() },
  ];
  if (input.leagueId !== undefined) {
    targets.push({
      target: "league",
      url: leagueViewUrl(input.season, input.leagueId, ["mSettings"]),
    });
  }
  return Promise.all(targets.map(({ target, url }) => probe(target, url)));
}

async function probe(
  target: ReachabilityResult["target"],
  url: string
): Promise<ReachabilityResult> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
    const result = contentType === "application/json" ? "espn_reachable" : "espn_challenge";
    return { target, result, status: response.status, contentType };
  } catch (error) {
    // fetch fails with a TypeError when it can't connect, and a TimeoutError past the deadline.
    const failedToConnect =
      error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
    if (!failedToConnect) throw error;
    return { target, result: "espn_unreachable", status: null, contentType: null };
  }
}
