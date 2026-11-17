import { createLogger } from "@injurysub/config";
import {
  getEspnAccess,
  listTeamNames,
  readLeagueRulesCheck,
  recordLeagueRulesCheck,
} from "@injurysub/db";
import {
  createEspnReadClient,
  EspnError,
  type LeagueRulesRead,
  type LineupsRead,
  type RuleMismatch,
} from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { dbTest } from "../test-support";
import { type LeagueFactsSource, readLeagueFacts } from "./league-facts";

const earlier = new Date("2026-11-17T03:45:00.000Z");
const now = new Date("2026-11-17T04:00:00.000Z");
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
  matchupPeriodId: 5,
  scoringPeriodId: 29,
  readAt: now.toISOString(),
};

const lineups = {
  meta,
  teams: [1, 2].map((teamId) => ({
    teamId,
    teamName: `Invented Team ${teamId}`,
    starters: [],
    bench: [],
    injuredReserve: [],
  })),
} as unknown as LineupsRead;

const mismatch: RuleMismatch = {
  kind: "setting",
  setting: "lineupLocktimeType",
  expected: "INDIVIDUAL_FIRSTGAME_WEEKLY",
  espn: "INDIVIDUAL_GAME",
};

function rulesWith(mismatches: RuleMismatch[]): LeagueRulesRead {
  return { meta, mismatches };
}

function espn(overrides: Partial<LeagueFactsSource> = {}): LeagueFactsSource {
  return {
    getLineups: async () => lineups,
    checkLeagueRules: async () => rulesWith([]),
    ...overrides,
  };
}

const refused = (code: "espn_unavailable" | "credentials_rejected") => async () => {
  throw new EspnError(code, "invented refusal");
};

function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
}

// Revision 2 item 2: the queue reads the team names and the rules check the worker stored.
describe("readLeagueFacts", () => {
  dbTest(
    "stores the team names and the rules check, and records ESPN as working",
    async ({ database }) => {
      const { connection } = database;

      await readLeagueFacts({ connection, espn: espn(), logger, now });

      expect(await listTeamNames(connection.db)).toEqual([
        { teamId: 1, name: "Invented Team 1", updatedAt: now },
        { teamId: 2, name: "Invented Team 2", updatedAt: now },
      ]);
      expect(await readLeagueRulesCheck(connection.db)).toEqual({
        mismatches: [],
        checkedAt: now,
        lastMatchedAt: now,
      });
      expect(await getEspnAccess(connection.db)).toMatchObject({
        state: "working",
        checkedAt: now,
      });
    }
  );

  dbTest("stores the mismatches a check found", async ({ database }) => {
    const { connection } = database;

    await readLeagueFacts({
      connection,
      espn: espn({ checkLeagueRules: async () => rulesWith([mismatch]) }),
      logger,
      now,
    });

    expect(await readLeagueRulesCheck(connection.db)).toEqual({
      mismatches: [mismatch],
      checkedAt: now,
      lastMatchedAt: null,
    });
  });

  dbTest(
    "keeps the last check through a refused rules read, still storing the names",
    async ({ database }) => {
      const { connection } = database;
      await recordLeagueRulesCheck(connection.db, { mismatches: [], checkedAt: earlier });

      await readLeagueFacts({
        connection,
        espn: espn({ checkLeagueRules: refused("espn_unavailable") }),
        logger,
        now,
      });

      expect(await readLeagueRulesCheck(connection.db)).toEqual({
        mismatches: [],
        checkedAt: earlier,
        lastMatchedAt: earlier,
      });
      expect(await listTeamNames(connection.db)).toHaveLength(2);
      expect(await getEspnAccess(connection.db)).toMatchObject({
        state: "unreachable",
        code: "espn_unavailable",
      });
      expect(warnings().some((line) => line.includes("worker.league_facts.espn_unread"))).toBe(
        true
      );
    }
  );

  dbTest("checks the rules though the lineups read was refused", async ({ database }) => {
    const { connection } = database;

    await readLeagueFacts({
      connection,
      espn: espn({ getLineups: refused("espn_unavailable") }),
      logger,
      now,
    });

    expect(await listTeamNames(connection.db)).toEqual([]);
    expect(await readLeagueRulesCheck(connection.db)).toMatchObject({ checkedAt: now });
  });

  dbTest(
    "records a worker given no cookie as not connected, storing nothing else",
    async ({ database }) => {
      const { connection } = database;

      await readLeagueFacts({
        connection,
        espn: createEspnReadClient({ mode: "none" }),
        logger,
        now,
      });

      expect(await getEspnAccess(connection.db)).toMatchObject({
        state: "not_connected",
        code: "not_connected",
        since: now,
      });
      expect(await listTeamNames(connection.db)).toEqual([]);
      expect(await readLeagueRulesCheck(connection.db)).toBe(null);
    }
  );
});
