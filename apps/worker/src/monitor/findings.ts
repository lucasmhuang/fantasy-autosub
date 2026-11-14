import type { ByHandCompletionRecord, SubRequestRecord, WriteAttemptRecord } from "@injurysub/db";
import {
  ACTION_MATCH_WINDOW_MS,
  adjustmentMismatch,
  type ByHandCompletion,
  confirmedPlanOf,
  isKnownOwnerEdit,
  type LmLineupItem,
  type MisuseAlertKind,
  matchAppAdjustmentWrites,
  matchAppLineupWrites,
  matchByHandAdjustments,
  matchByHandCompletions,
  type SentAdjustmentWrite,
  type SentLineupWrite,
  toTenths,
} from "@injurysub/domain";
import {
  type CurrentWeekRead,
  type FeedAdjustment,
  type FeedLeagueChange,
  type LeagueTransaction,
  lineupSlotNames,
} from "@injurysub/espn";
import { z } from "zod";

// What a finding is about, for its alert's text (alert-text.ts).
export type FindingFacts =
  | { kind: "lm_transaction"; transaction: LeagueTransaction; lineupItems: LmLineupItem[] | null }
  | {
      kind: "lm_adjustment";
      adjustment: FeedAdjustment;
      deltaTenths: number;
      period: number | null;
    }
  | { kind: "lm_league_change"; change: FeedLeagueChange }
  | { kind: "league_public" }
  | {
      kind: "adjustment_mismatch";
      matchupId: number;
      period: number;
      expectedTenths: number;
      actualTenths: number;
    };

// A league-manager action or a state the app didn't account for, before it is recorded.
export type Finding = {
  espnRef: string;
  kind: MisuseAlertKind;
  teamId: number | null;
  espnAt: Date | null;
  facts: FindingFacts;
  // Already accounted for: a by-hand settle (Dec-D31a), or the owner's known edit (Dec-D15).
  acknowledged: { note: string; matchedRequestId: string | null } | null;
};

// What the app's own records say, over the window detection reads.
export type AppRecords = {
  lineupWrites: SentLineupWrite[];
  adjustmentWrites: SentAdjustmentWrite[];
  completions: (ByHandCompletion & { label: string })[];
  periodRequests: SubRequestRecord[];
};

export type LeagueRead = {
  week: CurrentWeekRead;
  transactions: LeagueTransaction[];
  adjustments: FeedAdjustment[];
  leagueChanges: FeedLeagueChange[];
  isPublic: boolean;
};

const lineupBodySchema = z.object({
  teamId: z.number(),
  scoringPeriodId: z.number(),
  items: z.array(
    z.object({ playerId: z.number(), fromLineupSlotId: z.number(), toLineupSlotId: z.number() })
  ),
});
const scheduleSideSchema = z.object({ teamId: z.number(), adjustmentReason: z.string() });
const scheduleBodySchema = z.array(
  z.object({ id: z.number(), home: scheduleSideSchema, away: scheduleSideSchema })
);

function slotName(slotId: number): string | null {
  return lineupSlotNames[slotId] ?? null;
}

// The edit's lineup items by slot name; null when any item isn't a lineup move between named slots.
export function lineupItemsOf(transaction: LeagueTransaction): LmLineupItem[] | null {
  const items: LmLineupItem[] = [];
  for (const item of transaction.items) {
    const fromSlot = slotName(item.fromSlotId);
    const toSlot = slotName(item.toSlotId);
    if (item.type !== "LINEUP" || fromSlot === null || toSlot === null) return null;
    items.push({ playerId: item.playerId, fromSlot, toSlot });
  }
  return items.length === 0 ? null : items;
}

// The app's sent writes, read as the edits and adjustments ESPN would show for them. A write ESPN
// refused changed nothing (B13), so it accounts for no action.
export function sentWritesOf(writes: readonly WriteAttemptRecord[]) {
  const lineupWrites: SentLineupWrite[] = [];
  const adjustmentWrites: SentAdjustmentWrite[] = [];
  for (const write of writes) {
    if (write.status === "failed" && write.failureCode === "write_refused") continue;
    if (write.kind === "lineup") {
      const body = lineupBodySchema.safeParse(write.body);
      const items = body.success ? lineupItemsOf(asTransaction(body.data)) : null;
      if (body.success && items !== null) {
        const { teamId, scoringPeriodId } = body.data;
        lineupWrites.push({ teamId, scoringPeriodId, sentAt: write.sentAt, items });
      }
      continue;
    }
    adjustmentWrites.push(...adjustmentSidesOf(write));
  }
  return { lineupWrites, adjustmentWrites };
}

function asTransaction(body: z.infer<typeof lineupBodySchema>): LeagueTransaction {
  return {
    transactionId: "",
    type: "ROSTER",
    status: "",
    teamId: body.teamId,
    scoringPeriodId: body.scoringPeriodId,
    byLeagueManager: true,
    proposedAt: new Date(0),
    items: body.items.map((item) => ({
      type: "LINEUP",
      playerId: item.playerId,
      fromSlotId: item.fromLineupSlotId,
      toSlotId: item.toLineupSlotId,
      fromTeamId: 0,
      toTeamId: 0,
    })),
  };
}

// The written side of a schedule write: ESPN posts a 247 only for a side whose value changed.
function adjustmentSidesOf(write: WriteAttemptRecord): SentAdjustmentWrite[] {
  const body = scheduleBodySchema.safeParse(write.body);
  if (!body.success) return [];
  return body.data.flatMap(({ id, home, away }) =>
    [home, away]
      .filter((side) => side.teamId === write.teamId)
      .map((side) => ({
        teamId: side.teamId,
        matchupId: id,
        sentAt: write.sentAt,
        reason: side.adjustmentReason,
      }))
  );
}

export function completionsOf(
  records: readonly ByHandCompletionRecord[]
): AppRecords["completions"] {
  return records.map(({ request, completedAt, requestSnapshotPayload }) => ({
    requestId: request.requestId,
    teamId: request.teamId,
    matchupId: request.matchupId,
    completedAt,
    plan: confirmedPlanOf(requestSnapshotPayload),
    finalAdjustmentTenths: request.finalAdjustmentTenths,
    label: `${request.replacementName} in for ${request.injuredName}`,
  }));
}

// A team whose request the commissioner is settling by hand: its fresh actions may be that
// settle, which the completion then names. They wait out the match window first.
function waitsForCommissioner(
  teamId: number,
  at: Date,
  context: { now: Date; records: AppRecords }
): boolean {
  const fresh = context.now.getTime() - at.getTime() < ACTION_MATCH_WINDOW_MS;
  return (
    fresh &&
    context.records.periodRequests.some(
      (request) => request.teamId === teamId && request.status === "needs_review"
    )
  );
}

// Each league-manager record with its lineup moves, if it is a lineup edit between named slots.
function lmEditsOf(transactions: readonly LeagueTransaction[]) {
  return transactions
    .filter((transaction) => transaction.byLeagueManager)
    .map((transaction) => {
      const lineupItems = lineupItemsOf(transaction);
      const { teamId, scoringPeriodId, proposedAt: at } = transaction;
      return { transaction, lineupItems, teamId, scoringPeriodId, at, items: lineupItems ?? [] };
    });
}

export function lineupFindings(
  transactions: readonly LeagueTransaction[],
  context: { now: Date; records: AppRecords; firstRun: boolean }
): Finding[] {
  const edits = lmEditsOf(transactions);
  const lineupEdits = edits.filter((edit) => edit.lineupItems !== null);
  const own = matchAppLineupWrites(lineupEdits, context.records.lineupWrites);
  const unclaimed = lineupEdits.filter((edit) => !own.has(edit));
  const settles = matchByHandCompletions(unclaimed, context.records.completions);
  const findings: Finding[] = [];
  for (const edit of edits) {
    if (own.has(edit)) continue;
    const { transaction, lineupItems } = edit;
    const settled = settles.get(edit) ?? null;
    if (settled === null && waitsForCommissioner(transaction.teamId, edit.at, context)) continue;
    findings.push({
      espnRef: `transaction:${transaction.transactionId}`,
      kind: "lm_transaction",
      teamId: transaction.teamId,
      espnAt: transaction.proposedAt,
      facts: { kind: "lm_transaction", transaction, lineupItems },
      acknowledged: acknowledgementFor(settled, context.firstRun && isKnownOwnerEdit(edit)),
    });
  }
  return findings;
}

function acknowledgementFor(
  settled: (ByHandCompletion & { label?: string }) | null,
  knownOwnerEdit: boolean
): Finding["acknowledged"] {
  if (settled !== null) {
    return {
      note: `Matches your by-hand completion of ${settled.label ?? "a request"}.`,
      matchedRequestId: settled.requestId,
    };
  }
  return knownOwnerEdit
    ? { note: "The owner's own edit, 2026-11-03 (Dec-D15).", matchedRequestId: null }
    : null;
}

export function adjustmentFindings(
  read: Pick<LeagueRead, "adjustments" | "week">,
  context: { now: Date; records: AppRecords }
): Finding[] {
  const observed = read.adjustments.map((adjustment) => ({
    ...adjustment,
    deltaTenths: toTenths(adjustment.totalAfter) - toTenths(adjustment.totalBefore),
  }));
  const own = matchAppAdjustmentWrites(observed, context.records.adjustmentWrites);
  const unclaimed = observed.filter((adjustment) => !own.has(adjustment));
  const settles = matchByHandAdjustments(unclaimed, context.records.completions);
  const findings: Finding[] = [];
  for (const adjustment of observed) {
    if (own.has(adjustment)) continue;
    const { deltaTenths, ...feed } = adjustment;
    const settled = settles.get(adjustment) ?? null;
    if (settled === null && waitsForCommissioner(adjustment.teamId, adjustment.at, context))
      continue;
    findings.push({
      espnRef: `feed:${adjustment.messageId}`,
      kind: "lm_adjustment",
      teamId: adjustment.teamId,
      espnAt: adjustment.at,
      facts: {
        kind: "lm_adjustment",
        adjustment: feed,
        deltaTenths,
        period: periodOf(read.week, adjustment.matchupId),
      },
      acknowledged: acknowledgementFor(settled, false),
    });
  }
  return findings;
}

function periodOf(week: CurrentWeekRead, matchupId: number): number | null {
  const inWeek = week.week.matchups.some((matchup) => matchup.matchupId === matchupId);
  return inWeek ? week.week.matchupPeriodId : null;
}

export function leagueFindings(read: LeagueRead, now: Date): Finding[] {
  const changes: Finding[] = read.leagueChanges.map((change) => ({
    espnRef: `feed:${change.messageId}`,
    kind: "lm_league_change",
    teamId: null,
    espnAt: change.at,
    facts: { kind: "lm_league_change", change },
    acknowledged: null,
  }));
  if (!read.isPublic) return changes;
  // One a day while the league stays public.
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  return [
    ...changes,
    {
      espnRef: `league_public:${day}`,
      kind: "league_public",
      teamId: null,
      espnAt: null,
      facts: { kind: "league_public" },
      acknowledged: null,
    },
  ];
}

// M7: each side of this week against the app's records of it.
export function mismatchFindings(week: CurrentWeekRead, records: AppRecords): Finding[] {
  const findings: Finding[] = [];
  for (const matchup of week.week.matchups) {
    for (const side of [matchup.home, matchup.away]) {
      if (side === null) continue;
      const actualTenths = toTenths(side.adjustment);
      const mismatch = adjustmentMismatch({
        teamId: side.teamId,
        matchupId: matchup.matchupId,
        actualTenths,
        requests: records.periodRequests,
      });
      if (mismatch === null) continue;
      findings.push({
        espnRef: `mismatch:${week.meta.season}:${matchup.matchupId}:${side.teamId}:${actualTenths}`,
        kind: "adjustment_mismatch",
        teamId: side.teamId,
        espnAt: null,
        facts: {
          kind: "adjustment_mismatch",
          matchupId: matchup.matchupId,
          period: week.week.matchupPeriodId,
          ...mismatch,
        },
        acknowledged: null,
      });
    }
  }
  return findings;
}
