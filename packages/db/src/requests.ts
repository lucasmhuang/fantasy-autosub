import { and, asc, desc, eq, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./client";
import { DatabaseError } from "./errors";
import { enqueueEmail, type NewOutboxEmail } from "./outbox";
import { subRequestEvents, subRequestSnapshots, subRequests } from "./schema";

export type SubRequestRecord = typeof subRequests.$inferSelect;
export type NewSubRequest = typeof subRequests.$inferInsert;
export type SubRequestEventRecord = typeof subRequestEvents.$inferSelect;
export type NewSubRequestEvent = Omit<typeof subRequestEvents.$inferInsert, "requestId">;
export type SubRequestSnapshotRecord = typeof subRequestSnapshots.$inferSelect;
export type NewSubRequestSnapshot = Omit<
  typeof subRequestSnapshots.$inferInsert,
  "requestId" | "phase"
>;

export type CreateRequestInput = {
  request: NewSubRequest;
  snapshot: NewSubRequestSnapshot;
  event: NewSubRequestEvent;
  email: NewOutboxEmail | null;
};

export type RequestDetail = {
  request: SubRequestRecord;
  snapshots: SubRequestSnapshotRecord[];
  events: SubRequestEventRecord[];
};

export type RequestPatch = Partial<
  Omit<NewSubRequest, "requestId" | "version" | "createdAt" | "updatedAt">
>;

// Statuses that free an injured player for a new request; the partial unique index uses the same.
const FREEING_STATUSES = ["refused", "rejected", "withdrawn"] as const;
const NEEDS_THE_COMMISSIONER = ["awaiting_approval", "needs_review"] as const;
// Statuses whose replacement was never credited, or no longer is.
const NOT_CREDITING = ["refused", "rejected", "withdrawn", "reversed"] as const;

// Records a request with its request-time snapshot, its first event and, when the commissioner
// must act, their email, all in the caller's transaction. A repeated (team, idempotency key) is
// one Confirm submitted again: it records nothing and gives back the request already recorded.
// Two different Confirms for one live injured player fail on sub_requests_active_injured_unique.
export async function createRequest(
  db: DatabaseExecutor,
  input: CreateRequestInput
): Promise<{ created: boolean; request: SubRequestRecord }> {
  const [inserted] = await db
    .insert(subRequests)
    .values(input.request)
    .onConflictDoNothing({ target: [subRequests.teamId, subRequests.idempotencyKey] })
    .returning();
  if (inserted === undefined) {
    return { created: false, request: await findByIdempotencyKey(db, input.request) };
  }

  const { requestId } = inserted;
  await insertSnapshot(db, requestId, "request", input.snapshot);
  await appendEvent(db, requestId, input.event);
  if (input.email !== null) await enqueueEmail(db, input.email);
  return { created: true, request: inserted };
}

async function findByIdempotencyKey(
  db: DatabaseExecutor,
  request: NewSubRequest
): Promise<SubRequestRecord> {
  const [existing] = await db
    .select()
    .from(subRequests)
    .where(
      and(
        eq(subRequests.teamId, request.teamId),
        eq(subRequests.idempotencyKey, request.idempotencyKey)
      )
    );
  // The insert lost to this row, which is gone only if its transaction rolled back in between.
  // Callers answer a DatabaseError with "try again", and the retried Confirm then records it.
  if (existing === undefined) {
    throw new DatabaseError(
      "conflict_unresolved",
      "The request a repeated Confirm matched is gone."
    );
  }
  return existing;
}

// The injured player's request this matchup that still holds him, if any.
export async function findActiveRequest(
  db: DatabaseExecutor,
  where: { season: number; matchupPeriodId: number; teamId: number; injuredPlayerId: number }
): Promise<SubRequestRecord | null> {
  const [row] = await db
    .select()
    .from(subRequests)
    .where(and(holdsInjuredPlayers(where), eq(subRequests.injuredPlayerId, where.injuredPlayerId)));
  return row ?? null;
}

// The team's requests this matchup that still hold their injured players (the partial unique
// index's rows), proving requests aside.
function holdsInjuredPlayers(where: { season: number; matchupPeriodId: number; teamId: number }) {
  return and(
    eq(subRequests.season, where.season),
    eq(subRequests.matchupPeriodId, where.matchupPeriodId),
    eq(subRequests.teamId, where.teamId),
    notInArray(subRequests.status, [...FREEING_STATUSES]),
    ne(subRequests.kind, "proving")
  );
}

// The team's requests this matchup that still hold their injured players, for its board.
export async function listActiveTeamRequests(
  db: DatabaseExecutor,
  where: { season: number; matchupPeriodId: number; teamId: number }
): Promise<SubRequestRecord[]> {
  return db.select().from(subRequests).where(holdsInjuredPlayers(where));
}

// The team's earlier request this matchup that put this request's injured player in as its
// replacement, and whose credit counts or will once it settles. He can only be this request's
// starter if that swap reached ESPN some way, so the earlier request counts whatever its record
// says of its lineup. Never a rehearsal, a proving request, or one reversed, rejected, withdrawn
// or refused (A20).
export async function findEarlierCreditingRequest(
  db: DatabaseExecutor,
  request: Pick<
    SubRequestRecord,
    "requestId" | "season" | "matchupPeriodId" | "teamId" | "injuredPlayerId" | "createdAt"
  >
): Promise<SubRequestRecord | null> {
  const [row] = await db
    .select()
    .from(subRequests)
    .where(
      and(
        eq(subRequests.season, request.season),
        eq(subRequests.matchupPeriodId, request.matchupPeriodId),
        eq(subRequests.teamId, request.teamId),
        eq(subRequests.replacementPlayerId, request.injuredPlayerId),
        ne(subRequests.requestId, request.requestId),
        lt(subRequests.createdAt, request.createdAt),
        ne(subRequests.kind, "proving"),
        eq(subRequests.isRehearsal, false),
        notInArray(subRequests.status, [...NOT_CREDITING])
      )
    )
    .orderBy(desc(subRequests.createdAt))
    .limit(1);
  return row ?? null;
}

// A manager's history: their team's requests, newest first. Proving requests are tests, kept
// out of it.
export async function listTeamRequests(
  db: DatabaseExecutor,
  teamId: number
): Promise<SubRequestRecord[]> {
  return db
    .select()
    .from(subRequests)
    .where(and(eq(subRequests.teamId, teamId), ne(subRequests.kind, "proving")))
    .orderBy(desc(subRequests.createdAt));
}

// The queued request that has waited longest: the executor's next.
export async function findOldestQueuedRequest(
  db: DatabaseExecutor
): Promise<SubRequestRecord | null> {
  const [request] = await db
    .select()
    .from(subRequests)
    .where(eq(subRequests.status, "queued"))
    .orderBy(asc(subRequests.createdAt), asc(subRequests.requestId))
    .limit(1);
  return request ?? null;
}

// The executing request claimed longest ago. Under the write lease no pass is running, so it is
// one a stopped or interrupted pass left behind: recovery's next.
export async function findOldestExecutingRequest(
  db: DatabaseExecutor
): Promise<SubRequestRecord | null> {
  const [request] = await db
    .select()
    .from(subRequests)
    .where(eq(subRequests.status, "executing"))
    .orderBy(asc(subRequests.updatedAt), asc(subRequests.requestId))
    .limit(1);
  return request ?? null;
}

// Requests waiting for approval or execution, oldest first: what the expiry sweep looks at.
export async function listWaitingRequests(db: DatabaseExecutor): Promise<SubRequestRecord[]> {
  return db
    .select()
    .from(subRequests)
    .where(inArray(subRequests.status, ["awaiting_approval", "queued"]))
    .orderBy(asc(subRequests.createdAt));
}

// Every team's requests: those waiting for the commissioner first, longest-waiting first; then
// the rest, newest first. Proving requests are tests, kept on their own page.
export async function listCommissionerQueue(db: DatabaseExecutor): Promise<SubRequestRecord[]> {
  const notProving = ne(subRequests.kind, "proving");
  const waiting = await db
    .select()
    .from(subRequests)
    .where(and(inArray(subRequests.status, [...NEEDS_THE_COMMISSIONER]), notProving))
    .orderBy(asc(subRequests.createdAt));
  const rest = await db
    .select()
    .from(subRequests)
    .where(and(notInArray(subRequests.status, [...NEEDS_THE_COMMISSIONER]), notProving))
    .orderBy(desc(subRequests.createdAt));
  return [...waiting, ...rest];
}

// The proving requests, newest first: the proving page's list. They are tests, shown nowhere else.
export async function listProvingRequests(db: DatabaseExecutor): Promise<SubRequestRecord[]> {
  return db
    .select()
    .from(subRequests)
    .where(eq(subRequests.kind, "proving"))
    .orderBy(desc(subRequests.createdAt));
}

export async function getRequestDetail(
  db: DatabaseExecutor,
  requestId: string
): Promise<RequestDetail | null> {
  const [request] = await db.select().from(subRequests).where(eq(subRequests.requestId, requestId));
  if (request === undefined) return null;
  const snapshots = await db
    .select()
    .from(subRequestSnapshots)
    .where(eq(subRequestSnapshots.requestId, requestId))
    .orderBy(asc(subRequestSnapshots.takenAt));
  const events = await db
    .select()
    .from(subRequestEvents)
    .where(eq(subRequestEvents.requestId, requestId))
    .orderBy(asc(subRequestEvents.createdAt));
  return { request, snapshots, events };
}

// Applies a change only if the request is still in `fromStatus` at `version`, raising the
// version, so of two actions on one version only the first takes effect. Null when it lost.
export async function transitionRequest(
  db: DatabaseExecutor,
  change: {
    requestId: string;
    fromStatus: SubRequestRecord["status"];
    version: number;
    patch: RequestPatch;
    now: Date;
  }
): Promise<SubRequestRecord | null> {
  const [row] = await db
    .update(subRequests)
    .set({ ...change.patch, version: sql`${subRequests.version} + 1`, updatedAt: change.now })
    .where(
      and(
        eq(subRequests.requestId, change.requestId),
        eq(subRequests.status, change.fromStatus),
        eq(subRequests.version, change.version)
      )
    )
    .returning();
  return row ?? null;
}

export async function appendEvent(
  db: DatabaseExecutor,
  requestId: string,
  event: NewSubRequestEvent
): Promise<void> {
  await db.insert(subRequestEvents).values({ ...event, requestId });
}

export async function insertSnapshot(
  db: DatabaseExecutor,
  requestId: string,
  phase: SubRequestSnapshotRecord["phase"],
  snapshot: NewSubRequestSnapshot
): Promise<void> {
  await db.insert(subRequestSnapshots).values({ ...snapshot, requestId, phase });
}

// A request the commissioner marked done by hand: when, and its request-time snapshot, which holds
// the edit it confirmed (Dec-D31a).
export type ByHandCompletionRecord = {
  request: SubRequestRecord;
  completedAt: Date;
  requestSnapshotPayload: unknown;
};

// The by-hand completions recorded since a time, for misuse detection to match ESPN's actions to.
export async function listByHandCompletionsSince(
  db: DatabaseExecutor,
  since: Date
): Promise<ByHandCompletionRecord[]> {
  const rows = await db
    .select({ request: subRequests, completedAt: subRequestEvents.createdAt })
    .from(subRequestEvents)
    .innerJoin(subRequests, eq(subRequests.requestId, subRequestEvents.requestId))
    .where(
      and(
        eq(subRequestEvents.eventType, "completed_manually"),
        gte(subRequestEvents.createdAt, since)
      )
    )
    .orderBy(asc(subRequestEvents.createdAt));
  const completions: ByHandCompletionRecord[] = [];
  for (const { request, completedAt } of rows) {
    const [snapshot] = await db
      .select({ payload: subRequestSnapshots.payload })
      .from(subRequestSnapshots)
      .where(
        and(
          eq(subRequestSnapshots.requestId, request.requestId),
          eq(subRequestSnapshots.phase, "request")
        )
      );
    completions.push({ request, completedAt, requestSnapshotPayload: snapshot?.payload ?? null });
  }
  return completions;
}

// Every request of a matchup period, whatever its status, for the sides' expected adjustments.
export async function listMatchupPeriodRequests(
  db: DatabaseExecutor,
  where: { season: number; matchupPeriodId: number }
): Promise<SubRequestRecord[]> {
  return db
    .select()
    .from(subRequests)
    .where(
      and(
        eq(subRequests.season, where.season),
        eq(subRequests.matchupPeriodId, where.matchupPeriodId)
      )
    );
}
