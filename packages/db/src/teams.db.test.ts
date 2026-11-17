import { describe, expect } from "vitest";
import { listTeamNames, recordTeamNames } from "./teams";
import { dbTest } from "./test-support";

const first = new Date("2026-11-17T04:00:00.000Z");
const later = new Date("2026-11-17T04:15:00.000Z");

describe("team names", () => {
  dbTest("has none until the worker first reads the league", async ({ database }) => {
    expect(await listTeamNames(database.connection.db)).toEqual([]);
  });

  dbTest("keeps each team's name in team order", async ({ database }) => {
    const { db } = database.connection;
    await recordTeamNames(db, {
      teams: [
        { teamId: 2, name: "Second" },
        { teamId: 1, name: "First" },
      ],
      now: first,
    });

    expect(await listTeamNames(db)).toEqual([
      { teamId: 1, name: "First", updatedAt: first },
      { teamId: 2, name: "Second", updatedAt: first },
    ]);
  });

  dbTest(
    "takes a renamed team's new name, and leaves an unchanged one's time",
    async ({ database }) => {
      const { db } = database.connection;
      await recordTeamNames(db, {
        teams: [
          { teamId: 1, name: "First" },
          { teamId: 2, name: "Second" },
        ],
        now: first,
      });
      await recordTeamNames(db, {
        teams: [
          { teamId: 1, name: "First" },
          { teamId: 2, name: "Renamed" },
        ],
        now: later,
      });

      expect(await listTeamNames(db)).toEqual([
        { teamId: 1, name: "First", updatedAt: first },
        { teamId: 2, name: "Renamed", updatedAt: later },
      ]);
    }
  );

  dbTest("writes nothing for an empty read", async ({ database }) => {
    const { db } = database.connection;
    await recordTeamNames(db, { teams: [], now: first });

    expect(await listTeamNames(db)).toEqual([]);
  });
});
