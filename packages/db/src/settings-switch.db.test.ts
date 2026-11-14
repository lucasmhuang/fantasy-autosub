import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import type { DatabaseExecutor } from "./client";
import { userAccounts } from "./schema";
import {
  readLeagueSettings,
  switchAutomationOff,
  switchAutomationOn,
  writeLeagueSettings,
} from "./settings";
import { dbTest } from "./test-support";

const saved = new Date("2026-11-15T18:00:00.000Z");
const later = new Date("2026-11-15T18:05:00.000Z");
const latest = new Date("2026-11-15T18:10:00.000Z");

async function commissionerWith(db: DatabaseExecutor, teams: number[]): Promise<string> {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `commissioner-${userId}@example.test`,
    displayName: "Invented Commissioner",
    role: "commissioner",
  });
  await writeLeagueSettings(db, {
    executionMode: "approval_required",
    writeAllowlist: teams,
    updatedBy: userId,
    now: saved,
    shownUpdatedAt: null,
  });
  return userId;
}

// O11, Dec-D31e.
describe("the automation switch", () => {
  dbTest(
    "switches automation off by emptying the team list, and back on by restoring it and the mode",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await commissionerWith(db, [1, 4, 7]);

      expect(await switchAutomationOff(db, { updatedBy: userId, now: later })).toBe(true);
      expect(await readLeagueSettings(db)).toMatchObject({
        executionMode: "approval_required",
        writeAllowlist: [],
        allowlistBeforeOff: [1, 4, 7],
        updatedAt: later,
      });
      expect(await switchAutomationOn(db, { updatedBy: userId, now: latest })).toBe(true);
      expect(await readLeagueSettings(db)).toMatchObject({
        executionMode: "approval_required",
        writeAllowlist: [1, 4, 7],
        allowlistBeforeOff: null,
        updatedAt: latest,
      });
    }
  );

  dbTest(
    "changes nothing switching off what is already off, or on with nothing to restore",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await commissionerWith(db, []);

      expect(await switchAutomationOff(db, { updatedBy: userId, now: later })).toBe(false);
      expect(await switchAutomationOn(db, { updatedBy: userId, now: later })).toBe(false);
      expect(await readLeagueSettings(db)).toMatchObject({
        writeAllowlist: [],
        allowlistBeforeOff: null,
        updatedAt: saved,
      });
    }
  );

  dbTest("forgets the switched-off team list once the settings are saved", async ({ database }) => {
    const { db } = database.connection;
    const userId = await commissionerWith(db, [1, 4]);
    await switchAutomationOff(db, { updatedBy: userId, now: later });

    await writeLeagueSettings(db, {
      executionMode: "auto",
      writeAllowlist: [2],
      updatedBy: userId,
      now: latest,
      shownUpdatedAt: later,
    });

    expect(await readLeagueSettings(db)).toMatchObject({
      executionMode: "auto",
      writeAllowlist: [2],
      allowlistBeforeOff: null,
    });
  });
});
