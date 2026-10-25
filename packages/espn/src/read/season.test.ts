import { describe, expect, it, vi } from "vitest";
import { EspnError } from "./errors";
import { createSeasonCheck, type RequestGameRoot } from "./season";

// Shaped like ESPN's game root (GET …/apis/v3/games/fba), as saved by the 2026-10-23 probe.
const gameRoot = {
  abbrev: "fba",
  active: true,
  currentSeason: { active: true, id: 2027 },
  currentSeasonId: 2027,
  name: "Fantasy Basketball",
};

const signal = new AbortController().signal;

async function checkFailure(check: Promise<void>): Promise<EspnError> {
  try {
    await check;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the season check to fail");
}

describe("createSeasonCheck", () => {
  it("refuses a configured season that isn't the season in progress, naming both", async () => {
    const check = createSeasonCheck(2026, async () => gameRoot);

    const error = await checkFailure(check(signal));

    expect(error.code).toBe("season_not_in_progress");
    expect(error.message).toMatch(/2026/);
    expect(error.message).toMatch(/2027/);
  });

  it("passes when the configured season is the one in progress", async () => {
    const check = createSeasonCheck(2027, async () => gameRoot);

    await expect(check(signal)).resolves.toBeUndefined();
  });

  it("reports a game root without a current season id as unrecognized", async () => {
    const check = createSeasonCheck(2027, async () => ({ abbrev: "fba", active: true }));

    const error = await checkFailure(check(signal));

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/currentSeasonId/);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("asks again after a failed check, instead of keeping the failure", async () => {
    const outage = new EspnError(
      "espn_unavailable",
      "ESPN unavailable: HTTP 503 reading the game root"
    );
    const requestGameRoot = vi
      .fn<RequestGameRoot>()
      .mockRejectedValueOnce(outage)
      .mockResolvedValue(gameRoot);
    const check = createSeasonCheck(2027, requestGameRoot);

    await expect(check(signal)).rejects.toBe(outage);
    await expect(check(signal)).resolves.toBeUndefined();
    expect(requestGameRoot).toHaveBeenCalledTimes(2);
  });

  it("shares one request among concurrent first checks, and keeps a success", async () => {
    const requestGameRoot = vi.fn<RequestGameRoot>().mockResolvedValue(gameRoot);
    const check = createSeasonCheck(2027, requestGameRoot);

    await Promise.all([check(signal), check(signal), check(signal)]);
    await check(signal);

    expect(requestGameRoot).toHaveBeenCalledTimes(1);
  });
});
