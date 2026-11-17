import { eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { leagueRulesCheck } from "./schema";

// The worker's last read of the league's rules: what differed from the PRD's (ESPN's read's own
// mismatches, empty when they match), when, and the newest check that matched (null before any).
export type LeagueRulesCheck = {
  mismatches: unknown[];
  checkedAt: Date;
  lastMatchedAt: Date | null;
};

export async function readLeagueRulesCheck(db: DatabaseExecutor): Promise<LeagueRulesCheck | null> {
  const [row] = await db
    .select({
      mismatches: leagueRulesCheck.mismatches,
      checkedAt: leagueRulesCheck.checkedAt,
      lastMatchedAt: leagueRulesCheck.lastMatchedAt,
    })
    .from(leagueRulesCheck)
    .where(eq(leagueRulesCheck.checkId, 1));
  return row ?? null;
}

// Records one successful read of the rules. A match moves the last match to this check; a
// mismatch keeps the one before.
export async function recordLeagueRulesCheck(
  db: DatabaseExecutor,
  input: { mismatches: readonly unknown[]; checkedAt: Date }
): Promise<void> {
  const matched = input.mismatches.length === 0;
  await db
    .insert(leagueRulesCheck)
    .values({
      checkId: 1,
      mismatches: [...input.mismatches],
      checkedAt: input.checkedAt,
      lastMatchedAt: matched ? input.checkedAt : null,
    })
    .onConflictDoUpdate({
      target: leagueRulesCheck.checkId,
      set: {
        mismatches: sql`excluded.mismatches`,
        checkedAt: sql`excluded.checked_at`,
        lastMatchedAt: matched ? sql`excluded.checked_at` : sql`${leagueRulesCheck.lastMatchedAt}`,
      },
    });
}
