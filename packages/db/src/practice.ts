import { asc, eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { espnWrites, leagueSettings, subRequests } from "./schema";

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
