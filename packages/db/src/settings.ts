import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { leagueSettings } from "./schema";

export type LeagueSettings = {
  executionMode: (typeof leagueSettings.$inferSelect)["executionMode"];
  writeAllowlist: number[];
  // The team list automation had when switched off from the commissioner's pages (Dec-D31e).
  allowlistBeforeOff: number[] | null;
  provingDoneAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

const DEFAULT_SETTINGS: LeagueSettings = {
  executionMode: "approval_required",
  writeAllowlist: [],
  allowlistBeforeOff: null,
  provingDoneAt: null,
  updatedBy: null,
  updatedAt: null,
};

// The league's settings, or the defaults (approval-required, automation off) before any save.
export async function readLeagueSettings(db: DatabaseExecutor): Promise<LeagueSettings> {
  const [row] = await db.select().from(leagueSettings);
  if (row === undefined) return DEFAULT_SETTINGS;
  const { executionMode, writeAllowlist, allowlistBeforeOff, provingDoneAt, updatedBy, updatedAt } =
    row;
  return { executionMode, writeAllowlist, allowlistBeforeOff, provingDoneAt, updatedBy, updatedAt };
}

// Saves over the settings the commissioner was shown (their updatedAt, null before any save), so a
// tab showing older settings can't silently undo a later change; false when they've changed since.
export async function writeLeagueSettings(
  db: DatabaseExecutor,
  input: {
    executionMode: LeagueSettings["executionMode"];
    writeAllowlist: number[];
    updatedBy: string;
    now: Date;
    shownUpdatedAt: Date | null;
  }
): Promise<boolean> {
  // A save is the commissioner's own choice of teams, so a switched-off list is forgotten.
  const values = {
    executionMode: input.executionMode,
    writeAllowlist: input.writeAllowlist,
    allowlistBeforeOff: null,
    updatedBy: input.updatedBy,
    updatedAt: input.now,
  };
  const written =
    input.shownUpdatedAt === null
      ? await db
          .insert(leagueSettings)
          .values(values)
          .onConflictDoNothing({ target: leagueSettings.settingsId })
          .returning({ settingsId: leagueSettings.settingsId })
      : await db
          .update(leagueSettings)
          .set(values)
          .where(eq(leagueSettings.updatedAt, input.shownUpdatedAt))
          .returning({ settingsId: leagueSettings.settingsId });
  return written.length > 0;
}

// Marks proving done, once: the first date stays. The mode, the allowlist and when they were
// last saved are left as they are; before any save, the row is made with the defaults.
export async function markProvingDone(
  db: DatabaseExecutor,
  input: { updatedBy: string; now: Date }
): Promise<void> {
  await db
    .insert(leagueSettings)
    .values({ provingDoneAt: input.now, updatedBy: input.updatedBy, updatedAt: input.now })
    .onConflictDoUpdate({
      target: leagueSettings.settingsId,
      set: {
        provingDoneAt: sql`coalesce(${leagueSettings.provingDoneAt}, excluded.proving_done_at)`,
      },
    });
}

// When the worker saw ESPN's day pass the season's final one, with the final matchup's result it
// kept then; null during the season.
export type SeasonEnd = { endedAt: Date; final: unknown };

export async function readSeasonEnd(db: DatabaseExecutor): Promise<SeasonEnd | null> {
  const [row] = await db
    .select({ endedAt: leagueSettings.seasonEndedAt, final: leagueSettings.seasonFinal })
    .from(leagueSettings)
    .where(isNotNull(leagueSettings.seasonEndedAt));
  return row?.endedAt ? { endedAt: row.endedAt, final: row.final } : null;
}

// Records the season's end once, before any settings were saved too (a row it makes carries the
// end as its update time, which the settings page can save over); false when it was already
// recorded, which a later sighting leaves as it was.
export async function recordSeasonEnd(db: DatabaseExecutor, end: SeasonEnd): Promise<boolean> {
  const rows = await db
    .insert(leagueSettings)
    .values({ seasonEndedAt: end.endedAt, seasonFinal: end.final, updatedAt: end.endedAt })
    .onConflictDoUpdate({
      target: leagueSettings.settingsId,
      set: { seasonEndedAt: end.endedAt, seasonFinal: end.final },
      setWhere: isNull(leagueSettings.seasonEndedAt),
    })
    .returning({ settingsId: leagueSettings.settingsId });
  return rows.length > 0;
}

// Switches automation off from the commissioner's pages (O11): the team list is emptied, so the
// next write check refuses, and kept to restore (Dec-D31e). False when it was already off.
export async function switchAutomationOff(
  db: DatabaseExecutor,
  input: { updatedBy: string; now: Date }
): Promise<boolean> {
  const switched = await db
    .update(leagueSettings)
    .set({
      allowlistBeforeOff: sql`${leagueSettings.writeAllowlist}`,
      writeAllowlist: sql`'{}'::integer[]`,
      updatedBy: input.updatedBy,
      updatedAt: input.now,
    })
    .where(sql`cardinality(${leagueSettings.writeAllowlist}) > 0`)
    .returning({ settingsId: leagueSettings.settingsId });
  return switched.length > 0;
}

// Switches it back on with the team list it had; the mode was never changed. False when it
// wasn't switched off from the pages.
export async function switchAutomationOn(
  db: DatabaseExecutor,
  input: { updatedBy: string; now: Date }
): Promise<boolean> {
  const switched = await db
    .update(leagueSettings)
    .set({
      writeAllowlist: sql`${leagueSettings.allowlistBeforeOff}`,
      allowlistBeforeOff: null,
      updatedBy: input.updatedBy,
      updatedAt: input.now,
    })
    .where(isNotNull(leagueSettings.allowlistBeforeOff))
    .returning({ settingsId: leagueSettings.settingsId });
  return switched.length > 0;
}
