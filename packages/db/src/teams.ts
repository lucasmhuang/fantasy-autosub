import { asc, eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { teams } from "./schema";

export type TeamNameRecord = typeof teams.$inferSelect;

// Every team's name as the worker last read it, in team order; empty before its first read.
export async function listTeamNames(db: DatabaseExecutor): Promise<TeamNameRecord[]> {
  return db.select().from(teams).orderBy(asc(teams.teamId));
}

// One team's stored name; null before the worker has read the league.
export async function findTeamName(db: DatabaseExecutor, teamId: number): Promise<string | null> {
  const [team] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.teamId, teamId))
    .limit(1);
  return team?.name ?? null;
}

// Records the names one league read gave. A name unlike the stored one takes this read's time;
// an unchanged one keeps its own.
export async function recordTeamNames(
  db: DatabaseExecutor,
  input: { teams: { teamId: number; name: string }[]; now: Date }
): Promise<void> {
  if (input.teams.length === 0) return;
  await db
    .insert(teams)
    .values(input.teams.map((team) => ({ ...team, updatedAt: input.now })))
    .onConflictDoUpdate({
      target: teams.teamId,
      set: { name: sql`excluded.name`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`${teams.name} is distinct from excluded.name`,
    });
}
