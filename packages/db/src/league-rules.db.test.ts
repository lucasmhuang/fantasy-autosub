import { describe, expect } from "vitest";
import { readLeagueRulesCheck, recordLeagueRulesCheck } from "./league-rules";
import { dbTest } from "./test-support";

const first = new Date("2026-11-17T04:00:00.000Z");
const later = new Date("2026-11-17T04:15:00.000Z");
const latest = new Date("2026-11-17T04:30:00.000Z");
const mismatch = { kind: "setting", setting: "lineupLocktimeType", expected: "a", espn: "b" };

describe("the stored rules check", () => {
  dbTest("has no check until the worker first reads the rules", async ({ database }) => {
    expect(await readLeagueRulesCheck(database.connection.db)).toBe(null);
  });

  dbTest("records a match as the newest time the rules matched", async ({ database }) => {
    const { db } = database.connection;
    await recordLeagueRulesCheck(db, { mismatches: [], checkedAt: first });

    expect(await readLeagueRulesCheck(db)).toEqual({
      mismatches: [],
      checkedAt: first,
      lastMatchedAt: first,
    });
  });

  dbTest(
    "keeps the last match through a mismatch, and moves it at the next match",
    async ({ database }) => {
      const { db } = database.connection;
      await recordLeagueRulesCheck(db, { mismatches: [], checkedAt: first });
      await recordLeagueRulesCheck(db, { mismatches: [mismatch], checkedAt: later });

      expect(await readLeagueRulesCheck(db)).toEqual({
        mismatches: [mismatch],
        checkedAt: later,
        lastMatchedAt: first,
      });

      await recordLeagueRulesCheck(db, { mismatches: [], checkedAt: latest });

      expect(await readLeagueRulesCheck(db)).toEqual({
        mismatches: [],
        checkedAt: latest,
        lastMatchedAt: latest,
      });
    }
  );

  dbTest("has no last match while the rules have never matched", async ({ database }) => {
    const { db } = database.connection;
    await recordLeagueRulesCheck(db, { mismatches: [mismatch], checkedAt: first });

    expect(await readLeagueRulesCheck(db)).toEqual({
      mismatches: [mismatch],
      checkedAt: first,
      lastMatchedAt: null,
    });
  });
});
