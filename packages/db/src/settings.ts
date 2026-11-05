import type { DatabaseExecutor } from "./client";
import { leagueSettings } from "./schema";

export type LeagueSettings = {
  executionMode: (typeof leagueSettings.$inferSelect)["executionMode"];
  writeAllowlist: number[];
  provingDoneAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

const DEFAULT_SETTINGS: LeagueSettings = {
  executionMode: "approval_required",
  writeAllowlist: [],
  provingDoneAt: null,
  updatedBy: null,
  updatedAt: null,
};

// The league's settings, or the defaults (approval-required, automation off) before any save.
export async function readLeagueSettings(db: DatabaseExecutor): Promise<LeagueSettings> {
  const [row] = await db.select().from(leagueSettings);
  if (row === undefined) return DEFAULT_SETTINGS;
  const { executionMode, writeAllowlist, provingDoneAt, updatedBy, updatedAt } = row;
  return { executionMode, writeAllowlist, provingDoneAt, updatedBy, updatedAt };
}

export async function writeLeagueSettings(
  db: DatabaseExecutor,
  input: {
    executionMode: LeagueSettings["executionMode"];
    writeAllowlist: number[];
    updatedBy: string;
    now: Date;
  }
): Promise<void> {
  const values = {
    executionMode: input.executionMode,
    writeAllowlist: input.writeAllowlist,
    updatedBy: input.updatedBy,
    updatedAt: input.now,
  };
  await db
    .insert(leagueSettings)
    .values(values)
    .onConflictDoUpdate({ target: leagueSettings.settingsId, set: values });
}
