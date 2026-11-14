// Misuse detection's rules (C4): which league-manager actions on ESPN are the app's own or the
// commissioner's by-hand settles, and what a side's adjustment should be by the app's records.

export type LmLineupItem = { playerId: number; fromSlot: string; toSlot: string };

// A league-manager lineup edit in ESPN's transaction log, its lineup items by slot name.
export type ObservedLmEdit = {
  teamId: number;
  scoringPeriodId: number;
  at: Date;
  items: readonly LmLineupItem[];
};

// A lineup write the app sent (or may have: its answer was lost), from its own record.
export type SentLineupWrite = {
  teamId: number;
  scoringPeriodId: number | null;
  sentAt: Date;
  items: readonly LmLineupItem[];
};

// A request the commissioner marked done by hand: the edit it confirmed, the amount applied.
export type ByHandCompletion = {
  requestId: string;
  teamId: number;
  matchupId: number;
  completedAt: Date;
  plan: readonly LmLineupItem[] | null;
  finalAdjustmentTenths: number | null;
};

// An adjustment in ESPN's activity feed: the change in the side's total, in tenths.
export type ObservedAdjustment = {
  teamId: number;
  matchupId: number;
  at: Date;
  deltaTenths: number;
  reason: string;
};

export type SentAdjustmentWrite = {
  teamId: number;
  matchupId: number;
  sentAt: Date;
  reason: string;
};

// A request as the side's expected adjustment counts it.
export type LedgerRequest = {
  teamId: number;
  matchupId: number;
  kind: string;
  status: string;
  isRehearsal: boolean;
  finalAdjustmentTenths: number | null;
};

// How far apart ESPN's time for an action and the app's own record of it may be: the app sends
// within seconds of its record, and the commissioner marks a by-hand settle done within minutes of
// making it.
export const ACTION_MATCH_WINDOW_MS = 15 * 60 * 1000;

// Dec-D15: the team-1 league-manager lineup edit at 2026-11-03 00:43Z was the owner's own.
const KNOWN_OWNER_EDIT = {
  teamId: 1,
  from: Date.parse("2026-11-03T00:43:00.000Z"),
  minuteMs: 60_000,
};

// How far apart two times are, or null outside the match window.
function apart(a: Date, b: Date): number | null {
  const distance = Math.abs(a.getTime() - b.getTime());
  return distance <= ACTION_MATCH_WINDOW_MS ? distance : null;
}

// Pairs ESPN's actions with the app's records of them one to one, closest in time first: one write
// or by-hand settle accounts for one action, so a second identical action (made by hand, or by
// anyone else with the cookie) still alerts (B14: the same swap on ESPN two minutes before the
// app's write of it). `distanceMs` is null where a record can't be the action's.
function pairClosest<A, R>(
  actions: readonly A[],
  records: readonly R[],
  distanceMs: (action: A, record: R) => number | null
): Map<A, R> {
  const candidates = actions.flatMap((action) =>
    records.flatMap((record) => {
      const distance = distanceMs(action, record);
      return distance === null ? [] : [{ action, record, distance }];
    })
  );
  candidates.sort((a, b) => a.distance - b.distance);
  const pairs = new Map<A, R>();
  const taken = new Set<R>();
  for (const { action, record } of candidates) {
    if (pairs.has(action) || taken.has(record)) continue;
    pairs.set(action, record);
    taken.add(record);
  }
  return pairs;
}

function itemKey({ playerId, fromSlot, toSlot }: LmLineupItem): string {
  return `${playerId}:${fromSlot}>${toSlot}`;
}

// The same moves, in any order: ESPN's log needn't keep the order they were sent in.
function sameMoves(a: readonly LmLineupItem[], b: readonly LmLineupItem[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(itemKey));
  return b.every((item) => keys.has(itemKey(item)));
}

// The app's own writes behind league-manager edits (M2): the same team, day and moves, sent within
// the window of ESPN's time for it. An edit missing from the map is one the app didn't make.
export function matchAppLineupWrites<E extends ObservedLmEdit, W extends SentLineupWrite>(
  edits: readonly E[],
  writes: readonly W[]
): Map<E, W> {
  return pairClosest(edits, writes, (edit, write) =>
    write.teamId === edit.teamId &&
    write.scoringPeriodId === edit.scoringPeriodId &&
    sameMoves(write.items, edit.items)
      ? apart(write.sentAt, edit.at)
      : null
  );
}

// The by-hand completions edits settle (Dec-D31a): the same team and exactly the confirmed moves,
// within minutes of the completion. Anything short of that is an alert.
export function matchByHandCompletions<E extends ObservedLmEdit, C extends ByHandCompletion>(
  edits: readonly E[],
  completions: readonly C[]
): Map<E, C> {
  return pairClosest(edits, completions, (edit, completion) =>
    completion.teamId === edit.teamId &&
    completion.plan !== null &&
    sameMoves(completion.plan, edit.items)
      ? apart(completion.completedAt, edit.at)
      : null
  );
}

// What undoing an edit takes (M10): its moves swapped, last first, so each slot is free when its
// move comes (B13: the reverse-order inverse restored a three-item edit whole).
export function inverseLineupMoves(items: readonly LmLineupItem[]): LmLineupItem[] {
  return [...items]
    .reverse()
    .map(({ playerId, fromSlot, toSlot }) => ({ playerId, fromSlot: toSlot, toSlot: fromSlot }));
}

export function isKnownOwnerEdit(edit: Pick<ObservedLmEdit, "teamId" | "at">): boolean {
  const offset = edit.at.getTime() - KNOWN_OWNER_EDIT.from;
  return (
    edit.teamId === KNOWN_OWNER_EDIT.teamId && offset >= 0 && offset < KNOWN_OWNER_EDIT.minuteMs
  );
}

// The app's own adjustment writes behind ones in the feed: their team, matchup and the reason
// written, within the window. ESPN posts the reason as written.
export function matchAppAdjustmentWrites<
  A extends ObservedAdjustment,
  W extends SentAdjustmentWrite,
>(adjustments: readonly A[], writes: readonly W[]): Map<A, W> {
  return pairClosest(adjustments, writes, (adjustment, write) =>
    write.teamId === adjustment.teamId &&
    write.matchupId === adjustment.matchupId &&
    write.reason === adjustment.reason
      ? apart(write.sentAt, adjustment.at)
      : null
  );
}

// The by-hand completions adjustments settle: the amount applied, on its team and matchup, within
// minutes of it (Dec-D31a's exact match, for the adjustment half of a by-hand settle).
export function matchByHandAdjustments<A extends ObservedAdjustment, C extends ByHandCompletion>(
  adjustments: readonly A[],
  completions: readonly C[]
): Map<A, C> {
  return pairClosest(adjustments, completions, (adjustment, completion) =>
    completion.teamId === adjustment.teamId &&
    completion.matchupId === adjustment.matchupId &&
    completion.finalAdjustmentTenths === adjustment.deltaTenths
      ? apart(completion.completedAt, adjustment.at)
      : null
  );
}

const SETTLED = ["completed", "completed_manually"];
// A side whose request is being carried out, or is with the commissioner to settle by hand, may
// change at any moment; it is compared once that request settles.
const IN_FLUX = ["executing", "needs_review"];

// M7: a side's adjustment on ESPN against the sum its settled requests applied. Proving runs put
// their side back, and a rehearsal or a reversed request applies nothing. Null when they agree,
// or while the side is in flux.
export function adjustmentMismatch(side: {
  teamId: number;
  matchupId: number;
  actualTenths: number;
  requests: readonly LedgerRequest[];
}): { expectedTenths: number; actualTenths: number } | null {
  const own = side.requests.filter(
    (request) =>
      request.teamId === side.teamId &&
      request.matchupId === side.matchupId &&
      request.kind !== "proving" &&
      !request.isRehearsal
  );
  if (own.some((request) => IN_FLUX.includes(request.status))) return null;
  const expectedTenths = own
    .filter((request) => SETTLED.includes(request.status))
    .reduce((sum, request) => sum + (request.finalAdjustmentTenths ?? 0), 0);
  return expectedTenths === side.actualTenths
    ? null
    : { expectedTenths, actualTenths: side.actualTenths };
}
