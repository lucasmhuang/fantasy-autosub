import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { DatabaseError } from "./errors";
import { type espnAccessStateEnum, misuseAlerts, misuseWatch, workerHeartbeats } from "./schema";

type EspnAccessState = (typeof espnAccessStateEnum.enumValues)[number];

export type MisuseAlertRecord = typeof misuseAlerts.$inferSelect;
export type NewMisuseAlert = typeof misuseAlerts.$inferInsert;
export type MisuseWatchRecord = typeof misuseWatch.$inferSelect;
export type WorkerHeartbeatRecord = typeof workerHeartbeats.$inferSelect;

// Records an alert unless one for its ESPN reference exists (M4): `created` is true only for the
// call that made it, so each alert is emailed once. An existing alert is returned unchanged.
export async function recordMisuseAlert(
  db: DatabaseExecutor,
  alert: NewMisuseAlert
): Promise<{ alert: MisuseAlertRecord; created: boolean }> {
  const [inserted] = await db
    .insert(misuseAlerts)
    .values(alert)
    .onConflictDoNothing({ target: misuseAlerts.espnRef })
    .returning();
  if (inserted !== undefined) return { alert: inserted, created: true };
  const [existing] = await db
    .select()
    .from(misuseAlerts)
    .where(eq(misuseAlerts.espnRef, alert.espnRef));
  if (existing === undefined) {
    throw new DatabaseError(
      "conflict_unresolved",
      "a misuse alert's ESPN reference matched no row"
    );
  }
  return { alert: existing, created: false };
}

// Alerts still waiting for the commissioner, oldest ESPN time first (a found state has none).
export async function listOpenMisuseAlerts(db: DatabaseExecutor): Promise<MisuseAlertRecord[]> {
  return db
    .select()
    .from(misuseAlerts)
    .where(isNull(misuseAlerts.acknowledgedAt))
    .orderBy(asc(sql`coalesce(${misuseAlerts.espnAt}, ${misuseAlerts.foundAt})`));
}

// The latest acknowledged alerts, for the record.
export async function listAcknowledgedMisuseAlerts(
  db: DatabaseExecutor,
  limit: number
): Promise<MisuseAlertRecord[]> {
  return db
    .select()
    .from(misuseAlerts)
    .where(isNotNull(misuseAlerts.acknowledgedAt))
    .orderBy(desc(misuseAlerts.acknowledgedAt))
    .limit(limit);
}

// The commissioner acknowledges an open alert (M5). Null when it doesn't exist or was already
// acknowledged, which keeps the first acknowledgement's who and when.
export async function acknowledgeMisuseAlert(
  db: DatabaseExecutor,
  input: { alertId: string; userId: string; at: Date }
): Promise<MisuseAlertRecord | null> {
  const [row] = await db
    .update(misuseAlerts)
    .set({ acknowledgedAt: input.at, acknowledgedBy: input.userId })
    .where(and(eq(misuseAlerts.alertId, input.alertId), isNull(misuseAlerts.acknowledgedAt)))
    .returning();
  return row ?? null;
}

// Detection's last check, or null before its first.
export async function getMisuseWatch(db: DatabaseExecutor): Promise<MisuseWatchRecord | null> {
  const [row] = await db.select().from(misuseWatch).where(eq(misuseWatch.watchId, 1));
  return row ?? null;
}

// Records one detection check. A state unlike the stored one (or the first check) starts an
// episode: `since` becomes this check's time and startedNow is true, so a pause is announced once
// (M6). The day read through, the first run's time and the team's moves change only when given.
export async function recordMisuseWatch(
  db: DatabaseExecutor,
  input: {
    state: EspnAccessState;
    code: string | null;
    checkedAt: Date;
    scannedThroughDay?: number;
    firstRunAt?: Date;
    teamMoves?: unknown;
  }
): Promise<{ watch: MisuseWatchRecord; startedNow: boolean }> {
  const [watch] = await db
    .insert(misuseWatch)
    .values({
      watchId: 1,
      state: input.state,
      code: input.code,
      checkedAt: input.checkedAt,
      since: input.checkedAt,
      scannedThroughDay: input.scannedThroughDay ?? null,
      firstRunAt: input.firstRunAt ?? null,
      teamMoves: input.teamMoves ?? null,
    })
    .onConflictDoUpdate({
      target: misuseWatch.watchId,
      set: {
        state: sql`excluded.state`,
        code: sql`excluded.code`,
        checkedAt: sql`excluded.checked_at`,
        since: sql`case when ${misuseWatch.state} = excluded.state then ${misuseWatch.since} else excluded.since end`,
        scannedThroughDay: sql`coalesce(excluded.scanned_through_day, ${misuseWatch.scannedThroughDay})`,
        firstRunAt: sql`coalesce(${misuseWatch.firstRunAt}, excluded.first_run_at)`,
        teamMoves: sql`coalesce(excluded.team_moves, ${misuseWatch.teamMoves})`,
      },
    })
    .returning();
  if (watch === undefined) {
    throw new DatabaseError("conflict_unresolved", "recording the misuse watch returned no row");
  }
  return { watch, startedNow: watch.since.getTime() === input.checkedAt.getTime() };
}

// A worker's beat: one row per worker, its time moved on.
export async function recordWorkerHeartbeat(
  db: DatabaseExecutor,
  beat: { workerId: string; startedAt: Date; beatAt: Date }
): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values(beat)
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { beatAt: beat.beatAt } });
}

// The newest beat of any worker, or null before the first.
export async function getLatestWorkerHeartbeat(
  db: DatabaseExecutor
): Promise<WorkerHeartbeatRecord | null> {
  const [row] = await db
    .select()
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.beatAt))
    .limit(1);
  return row ?? null;
}
