import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/scoreboard-2026-11-15.json";
import { createReadClient } from "./client";
import { EspnError } from "./errors";
import { gameStatesOf, scoreboardDayOf, scoreboardResponseSchema } from "./scoreboard";
import { createLiveSource, createRecordedSource, type Recordings } from "./source";

const READ_NAME = "the NBA scoreboard for 2026-11-15";

function parsed(body: unknown) {
  return gameStatesOf(scoreboardResponseSchema.parse(body), READ_NAME);
}

function sighting(label: string) {
  const found = fixture.sightings.find((each) => each.label === label);
  if (!found) throw new Error(`the fixture has no sighting of ${label}`);
  return parsed({ events: [found.event] })[0];
}

function failure(run: () => unknown): EspnError {
  try {
    run();
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the parse to fail");
}

function withEvent(change: (event: (typeof fixture.snapshot.body.events)[number]) => void) {
  const body = structuredClone(fixture.snapshot.body);
  const event = body.events[0];
  if (!event) throw new Error("the fixture has no events");
  change(event);
  return body;
}

describe("scoreboardDayOf", () => {
  it("writes a calendar date as the scoreboard's dates parameter", () => {
    expect(scoreboardDayOf("2026-11-15")).toBe("20261115");
  });

  it.each(["2026-11-31", "20261115", "2026-11-15T00:00:00Z", ""])("refuses %j", (date) => {
    expect(() => scoreboardDayOf(date)).toThrow(RangeError);
  });
});

describe("gameStatesOf", () => {
  it("reads every game of the probed slate, by both NBA team ids", () => {
    const games = parsed(fixture.snapshot.body);

    expect(games).toHaveLength(9);
    expect(games[0]).toEqual({
      homeProTeamId: 20,
      awayProTeamId: 11,
      tip: "2026-11-15T18:00:00.000Z",
      phase: "final",
      period: 4,
      clock: "0.0",
    });
  });

  it("reads each state the probe saw at once: final, live, halftime and scheduled", () => {
    const games = parsed(fixture.snapshot.body);
    const phases = games.map((game) => `${game.phase}:${game.period}:${game.clock}`);

    expect(phases).toContain("live:4:1:15");
    // Halftime is a live game: ESPN gives it state "in" and its own status name.
    expect(phases).toContain("live:2:0.0");
    expect(phases).toContain("scheduled:0:0.0");
  });

  it("reads the end of a period, overtime and a clock with tenths as ESPN gives them", () => {
    expect(sighting("end of a period")).toMatchObject({ phase: "live", period: 3 });
    // The 4th's end isn't the game's: this one went on to overtime.
    expect(sighting("end of the 4th before overtime")).toMatchObject({ phase: "live", period: 4 });
    expect(sighting("overtime in progress")).toMatchObject({ phase: "live", period: 5 });
    expect(sighting("final after overtime")).toMatchObject({ phase: "final", period: 5 });
    expect(sighting("under a minute, with tenths")?.clock).toMatch(/^\d+\.\d$/);
  });

  // The page never calls a game live or final unless the scoreboard does (FM-BOARD-9): a game that
  // is over without being completed (postponed, canceled) or not yet on the clock in another way is
  // neither.
  it.each([
    ["post", "STATUS_POSTPONED", false],
    ["post", "STATUS_CANCELED", false],
    ["pre", "STATUS_DELAYED", false],
  ])("reads state %s with %s as neither live nor final", (state, name, completed) => {
    const body = withEvent((event) => {
      event.status.type = { ...event.status.type, state, name, completed };
    });

    expect(parsed(body)[0]?.phase).toBe("other");
  });

  it("refuses a game without exactly one home and one away team", () => {
    const body = withEvent((event) => {
      for (const competitor of event.competitions[0]?.competitors ?? []) {
        competitor.homeAway = "home";
      }
    });

    const error = failure(() => parsed(body));

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toContain(READ_NAME);
  });

  it("refuses a team id that isn't a whole number", () => {
    const body = withEvent((event) => {
      const competitor = event.competitions[0]?.competitors[0];
      if (competitor) competitor.team.id = "PHI";
    });

    expect(failure(() => parsed(body)).code).toBe("unrecognized_response");
  });

  it("keeps only what the read uses when the schema trims an answer", () => {
    const body = withEvent((event) => {
      Object.assign(event, { name: "Indiana Pacers at Philadelphia 76ers", leaders: [] });
    });

    expect(Object.keys(scoreboardResponseSchema.parse(body).events[0] ?? {})).toEqual([
      "date",
      "status",
      "competitions",
    ]);
  });
});

describe("getGameStates", () => {
  const capturedAt = "2026-11-16T01:06:16.562Z";
  const recordings = (responses: [string, unknown][]): Recordings => ({
    capturedAt,
    season: 2027,
    responses: new Map(responses),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a recorded day's games by the day's key, labelled as recorded", async () => {
    const source = createRecordedSource(async () =>
      recordings([["scoreboard:20261115", fixture.snapshot.body]])
    );
    const now = new Date("2026-11-16T01:10:00.000Z");

    const read = await createReadClient(source, { now: () => now }).getGameStates("2026-11-15");

    expect(read.meta).toEqual({ source: "recorded", capturedAt, readAt: now.toISOString() });
    expect(read.date).toBe("2026-11-15");
    expect(read.games).toHaveLength(9);
  });

  it("fails as not recorded for a day the recordings don't hold", async () => {
    const source = createRecordedSource(async () => recordings([]));

    const error = await createReadClient(source)
      .getGameStates("2026-11-15")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EspnError);
    expect(error).toMatchObject({ code: "not_recorded" });
  });

  // The board reads it after the team's week, so a slow scoreboard mustn't take a whole read's
  // time again: it has its own, shorter deadline.
  it("gives up on its own deadline, shorter than a read's", async () => {
    vi.stubGlobal(
      "fetch",
      (_input: unknown, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })
    );
    const source = createLiveSource({
      season: 2027,
      leagueId: 4567123,
      credentials: {
        espnS2: "AEBsyntheticCookie%3D",
        swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
      },
    });
    const reads = createReadClient(source, { timeoutMs: 10_000, scoreboardTimeoutMs: 100 });
    const started = performance.now();

    const error = await reads.getGameStates("2026-11-15").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "espn_unavailable" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
