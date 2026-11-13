import { eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { espnAccess, type espnAccessStateEnum } from "./schema";

type EspnAccessState = (typeof espnAccessStateEnum.enumValues)[number];

export type EspnAccessRecord = typeof espnAccess.$inferSelect;

// The worker's last check of ESPN, or null before its first.
export async function getEspnAccess(db: DatabaseExecutor): Promise<EspnAccessRecord | null> {
  const [row] = await db.select().from(espnAccess).where(eq(espnAccess.accessId, 1));
  return row ?? null;
}

// Records one check of ESPN. A state unlike the stored one (or the first check) starts an episode:
// `since` becomes this check's time and startedNow is true. The same state keeps its `since`.
export async function recordEspnAccess(
  db: DatabaseExecutor,
  input: { state: EspnAccessState; code: string | null; checkedAt: Date }
): Promise<{ access: EspnAccessRecord; startedNow: boolean }> {
  const [access] = await db
    .insert(espnAccess)
    .values({ accessId: 1, ...input, since: input.checkedAt })
    .onConflictDoUpdate({
      target: espnAccess.accessId,
      set: {
        state: sql`excluded.state`,
        code: sql`excluded.code`,
        checkedAt: sql`excluded.checked_at`,
        since: sql`case when ${espnAccess.state} = excluded.state then ${espnAccess.since} else excluded.since end`,
      },
    })
    .returning();
  if (access === undefined) throw new Error("recording ESPN access returned no row");
  return { access, startedNow: access.since.getTime() === input.checkedAt.getTime() };
}
