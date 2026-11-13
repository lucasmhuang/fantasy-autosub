import { describe, expect } from "vitest";
import { getEspnAccess, recordEspnAccess } from "./espn-access";
import { dbTest } from "./test-support";

const first = new Date("2026-11-13T18:00:00.000Z");
const later = new Date("2026-11-13T18:00:15.000Z");
const latest = new Date("2026-11-13T18:00:30.000Z");

describe("ESPN access", () => {
  dbTest("has no record until the worker first checks", async ({ database }) => {
    expect(await getEspnAccess(database.connection.db)).toBe(null);
  });

  dbTest(
    "starts an episode at the first check, and keeps it while the state holds",
    async ({ database }) => {
      const opened = await recordEspnAccess(database.connection.db, {
        state: "credentials_rejected",
        code: "credentials_rejected",
        checkedAt: first,
      });
      const held = await recordEspnAccess(database.connection.db, {
        state: "credentials_rejected",
        code: "credentials_rejected",
        checkedAt: later,
      });

      expect(opened.startedNow).toBe(true);
      expect(held.startedNow).toBe(false);
      expect(await getEspnAccess(database.connection.db)).toEqual({
        accessId: 1,
        state: "credentials_rejected",
        code: "credentials_rejected",
        since: first,
        checkedAt: later,
      });
    }
  );

  dbTest("starts a new episode when the state changes", async ({ database }) => {
    await recordEspnAccess(database.connection.db, {
      state: "working",
      code: null,
      checkedAt: first,
    });
    await recordEspnAccess(database.connection.db, {
      state: "working",
      code: null,
      checkedAt: later,
    });

    const refused = await recordEspnAccess(database.connection.db, {
      state: "credentials_rejected",
      code: "credentials_rejected",
      checkedAt: latest,
    });

    expect(refused).toEqual({
      startedNow: true,
      access: {
        accessId: 1,
        state: "credentials_rejected",
        code: "credentials_rejected",
        since: latest,
        checkedAt: latest,
      },
    });
  });
});
