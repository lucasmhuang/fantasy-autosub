import { createLogger } from "@injurysub/config";
import { readSeasonEnd } from "@injurysub/db";
import { type CurrentWeekRead, EspnError, type LineupsRead } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { dbTest } from "../test-support";
import { type SeasonSource, watchSeasonEnd } from "./season-watch";

const now = new Date("2027-03-22T09:00:00.000Z");
const logger = createLogger("worker", "debug");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const meta = {
  source: "recorded" as const,
  season: 2027,
  matchupPeriodId: 21,
  scoringPeriodId: 154,
  readAt: now.toISOString(),
};

const side = (teamId: number, score: number) => ({
  teamId,
  score,
  adjustment: 0,
  adjustmentReason: null,
  creditedPlayers: [],
});

// The final matchup period, days 147-153, read on ESPN's day `today`: the title game, 3 against 7.
function weekOn(today: number): CurrentWeekRead {
  return {
    meta: { ...meta, scoringPeriodId: today },
    week: {
      matchupPeriodId: 21,
      scoringPeriodIds: [147, 148, 149, 150, 151, 152, 153],
      completeScoringPeriodIds: [147, 148, 149, 150, 151, 152, 153].filter((day) => day < today),
      todayScoringPeriodId: today,
      finalScoringPeriodId: 153,
      matchups: [{ matchupId: 120, home: side(3, 812.4), away: side(7, 799.9) }],
    },
  };
}

const lineups = {
  meta,
  teams: [3, 7].map((teamId) => ({
    teamId,
    teamName: `Invented Team ${teamId}`,
    starters: [],
    bench: [],
    injuredReserve: [],
  })),
} as unknown as LineupsRead;

function espnOn(today: number): SeasonSource {
  return {
    getCurrentWeek: async () => weekOn(today),
    getLineups: async () => lineups,
  };
}

function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
}

// FS-SEASON-3, SC-SEASON-1's trigger (PC1-2): the worker records the season's end, once.
describe("watchSeasonEnd", () => {
  dbTest(
    "records the end and the final matchup's result once ESPN's day passes the final one",
    async ({ database }) => {
      const { connection } = database;

      await watchSeasonEnd({ connection, espn: espnOn(154), espnMode: "live", logger, now });
      await watchSeasonEnd({
        connection,
        espn: espnOn(160),
        espnMode: "live",
        logger,
        now: new Date("2027-03-28T09:00:00.000Z"),
      });

      expect(await readSeasonEnd(connection.db)).toEqual({
        endedAt: now,
        final: {
          matchupPeriodId: 21,
          matchups: [
            {
              home: { teamId: 3, teamName: "Invented Team 3", score: 812.4 },
              away: { teamId: 7, teamName: "Invented Team 7", score: 799.9 },
            },
          ],
        },
      });
    }
  );

  dbTest(
    "records it on a practice copy of ESPN too, for pnpm practice:reset to undo",
    async ({ database }) => {
      const { connection } = database;

      await watchSeasonEnd({ connection, espn: espnOn(154), espnMode: "practice", logger, now });

      expect((await readSeasonEnd(connection.db))?.endedAt).toEqual(now);
    }
  );

  // A recorded or scripted day isn't the league's: week-concluded's would end the season for good.
  dbTest.for(["stub", "scripted", "none"] as const)(
    "records nothing on %s ESPN, past the final day too",
    async (espnMode, { database }) => {
      const { connection } = database;

      await watchSeasonEnd({ connection, espn: espnOn(154), espnMode, logger, now });

      expect(await readSeasonEnd(connection.db)).toBeNull();
    }
  );

  dbTest("records nothing from a week that names no final day", async ({ database }) => {
    const { connection } = database;
    const { finalScoringPeriodId: _final, ...week } = weekOn(160).week;
    const espn: SeasonSource = {
      ...espnOn(160),
      getCurrentWeek: async () => ({ ...weekOn(160), week }),
    };

    await watchSeasonEnd({ connection, espn, espnMode: "live", logger, now });

    expect(await readSeasonEnd(connection.db)).toBeNull();
  });

  dbTest("records nothing on the season's final day", async ({ database }) => {
    const { connection } = database;

    await watchSeasonEnd({ connection, espn: espnOn(153), espnMode: "live", logger, now });

    expect(await readSeasonEnd(connection.db)).toBeNull();
  });

  dbTest.for([["getCurrentWeek"], ["getLineups"]] as const)(
    "records nothing, and says so, when ESPN refuses %s",
    async ([refused], { database }) => {
      const { connection } = database;
      const espn: SeasonSource = {
        ...espnOn(154),
        [refused]: async () => {
          throw new EspnError("espn_unavailable", "ESPN didn't answer");
        },
      };

      await watchSeasonEnd({ connection, espn, espnMode: "live", logger, now });

      expect(await readSeasonEnd(connection.db)).toBeNull();
      expect(warnings().some((line) => line.includes("worker.season.espn_unread"))).toBe(true);
      expect(warnings().some((line) => line.includes("espn_unavailable"))).toBe(true);
    }
  );
});
