import { eq, sql } from "drizzle-orm";
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
  const values = {
    executionMode: input.executionMode,
    writeAllowlist: input.writeAllowlist,
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
