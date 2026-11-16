import { asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import {
  emailOutbox,
  espnWrites,
  leagueSettings,
  misuseAlerts,
  subRequestEvents,
  subRequestSnapshots,
  subRequests,
} from "./schema";

// A database is a practice one (staging's, behind a practice ESPN) or a real one, never both: a
// practice worker runs only on a practice database, and a worker sending to the real league never
// does. This is when it became a practice one, or null for a real one.
export async function readPracticeSince(db: DatabaseExecutor): Promise<Date | null> {
  const [row] = await db.select({ since: leagueSettings.practiceSince }).from(leagueSettings);
  return row?.since ?? null;
}

// Marks a database that has never held a request as a practice one, before any settings were
// saved too, in one statement so a request filed meanwhile can't slip under the mark. (Every ESPN
// write belongs to a request, so such a database has none either.) Returns when it became one, the
// first mark kept, or null for a database that holds a request and no mark, left as it was.
export async function markEmptyDatabasePractice(
  db: DatabaseExecutor,
  now: Date
): Promise<Date | null> {
  const noRequest = sql`not exists (select 1 from ${subRequests})`;
  await db.execute(sql`
    insert into ${leagueSettings} (practice_since)
    select ${now.toISOString()}::timestamptz where ${noRequest}
    on conflict (settings_id) do update set practice_since = excluded.practice_since
    where ${leagueSettings.practiceSince} is null`);
  return readPracticeSince(db);
}

export type VerifiedWrite = { writeId: string; kind: "lineup" | "adjustment"; body: unknown };

// Every ESPN write read back as applied, in the order sent: a practice copy of ESPN is its seed
// with these applied.
export async function listVerifiedWrites(db: DatabaseExecutor): Promise<VerifiedWrite[]> {
  return db
    .select({ writeId: espnWrites.writeId, kind: espnWrites.kind, body: espnWrites.body })
    .from(espnWrites)
    .where(eq(espnWrites.outcome, "verified"))
    .orderBy(asc(espnWrites.sentAt), asc(espnWrites.writeId));
}

export type PracticeResetStanding = "practice" | "markable" | "real";
export type PracticeResetCounts = {
  requests: number;
  writes: number;
  emails: number;
  alerts: number;
};

// Whether a reset may empty this database: a practice one; or one whose writes were only ever
// recorded, never sent (a rehearsal's), which the reset then marks practice; or a real one, whose
// writes reached ESPN or may have, which a reset never touches.
export async function readPracticeResetStanding(
  db: DatabaseExecutor
): Promise<PracticeResetStanding> {
  if ((await readPracticeSince(db)) !== null) return "practice";
  const [sent] = await db
    .select({ writeId: espnWrites.writeId })
    .from(espnWrites)
    .where(ne(espnWrites.status, "recorded_only"))
    .limit(1);
  return sent === undefined ? "markable" : "real";
}

// What a reset would remove: every request and write, the outbox's emails about a request, and
// the misuse alerts it would unmatch.
export async function countPracticeReset(db: DatabaseExecutor): Promise<PracticeResetCounts> {
  return {
    requests: await db.$count(subRequests),
    writes: await db.$count(espnWrites),
    emails: await db.$count(emailOutbox, isNotNull(emailOutbox.requestId)),
    alerts: await db.$count(misuseAlerts, isNotNull(misuseAlerts.matchedRequestId)),
  };
}

// Empties a practice database's requests with every row that points at one: their emails in the
// outbox, their ESPN writes, events and snapshots; a misuse alert matched to one is kept, its match
// cleared. The caller decides the database may be emptied (readPracticeResetStanding) and runs
// this in one transaction under the ESPN-write lease. With `mark`, the database becomes a practice
// one, its first mark kept.
export async function resetPracticeDatabase(
  db: DatabaseExecutor,
  input: { now: Date; mark: boolean }
): Promise<PracticeResetCounts> {
  if (input.mark) {
    await db
      .insert(leagueSettings)
      .values({ practiceSince: input.now })
      .onConflictDoUpdate({
        target: leagueSettings.settingsId,
        set: { practiceSince: input.now },
        setWhere: isNull(leagueSettings.practiceSince),
      });
  }
  const emails = await db
    .delete(emailOutbox)
    .where(isNotNull(emailOutbox.requestId))
    .returning({ id: emailOutbox.emailId });
  const alerts = await db
    .update(misuseAlerts)
    .set({ matchedRequestId: null })
    .where(isNotNull(misuseAlerts.matchedRequestId))
    .returning({ id: misuseAlerts.alertId });
  const writes = await db.delete(espnWrites).returning({ id: espnWrites.writeId });
  await db.delete(subRequestEvents);
  await db.delete(subRequestSnapshots);
  const requests = await db.delete(subRequests).returning({ id: subRequests.requestId });
  const counts = { emails: emails.length, alerts: alerts.length, writes: writes.length };
  return { requests: requests.length, ...counts };
}
