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

function withinWindow(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= ACTION_MATCH_WINDOW_MS;
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

// The app's own write behind a league-manager edit (M2): the same team, day and moves, sent within
// the window of ESPN's time for it. Null means the app didn't make it.
export function findAppLineupWrite(
  edit: ObservedLmEdit,
  writes: readonly SentLineupWrite[]
): SentLineupWrite | null {
  const found = writes.find(
    (write) =>
      write.teamId === edit.teamId &&
      write.scoringPeriodId === edit.scoringPeriodId &&
      withinWindow(write.sentAt, edit.at) &&
      sameMoves(write.items, edit.items)
  );
  return found ?? null;
}

// The by-hand completion an edit settles (Dec-D31a): the same team and exactly the confirmed
// moves, within minutes of the completion. Anything short of that is an alert.
export function findByHandCompletion(
  edit: ObservedLmEdit,
  completions: readonly ByHandCompletion[]
): ByHandCompletion | null {
  const found = completions.find(
    (completion) =>
      completion.teamId === edit.teamId &&
      completion.plan !== null &&
      withinWindow(completion.completedAt, edit.at) &&
      sameMoves(completion.plan, edit.items)
  );
  return found ?? null;
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

// The app's own adjustment write behind one in the feed: its team, matchup and the reason it wrote,
// within the window. ESPN posts the reason as written.
export function findAppAdjustmentWrite(
  adjustment: ObservedAdjustment,
  writes: readonly SentAdjustmentWrite[]
): SentAdjustmentWrite | null {
  const found = writes.find(
    (write) =>
      write.teamId === adjustment.teamId &&
      write.matchupId === adjustment.matchupId &&
      write.reason === adjustment.reason &&
      withinWindow(write.sentAt, adjustment.at)
  );
  return found ?? null;
}

// The by-hand completion an adjustment settles: the amount it applied, on its team and matchup,
// within minutes of it (Dec-D31a's exact match, for the adjustment half of a by-hand settle).
export function findByHandAdjustment(
  adjustment: ObservedAdjustment,
  completions: readonly ByHandCompletion[]
): ByHandCompletion | null {
  const found = completions.find(
    (completion) =>
      completion.teamId === adjustment.teamId &&
      completion.matchupId === adjustment.matchupId &&
      completion.finalAdjustmentTenths === adjustment.deltaTenths &&
      withinWindow(completion.completedAt, adjustment.at)
  );
  return found ?? null;
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
