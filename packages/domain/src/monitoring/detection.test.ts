import { describe, expect, it } from "vitest";
import {
  adjustmentMismatch,
  type ByHandCompletion,
  inverseLineupMoves,
  isKnownOwnerEdit,
  type LedgerRequest,
  matchAppAdjustmentWrites,
  matchAppLineupWrites,
  matchByHandAdjustments,
  matchByHandCompletions,
  type ObservedAdjustment,
  type ObservedLmEdit,
} from "./detection";

const at = new Date("2026-11-15T20:00:00.000Z");
const minutes = (count: number) => new Date(at.getTime() + count * 60_000);
const starterOut = { playerId: 11, fromSlot: "F/C", toSlot: "BE" };
const swap = [starterOut, { playerId: 22, fromSlot: "BE", toSlot: "F/C" }];
const edit: ObservedLmEdit = { teamId: 4, scoringPeriodId: 27, at, items: swap };

// The record one action is paired with, or null.
function pairedWith<A, R>(pairs: Map<A, R>, action: A): R | null {
  return pairs.get(action) ?? null;
}

describe("matchAppLineupWrites", () => {
  const write = { teamId: 4, scoringPeriodId: 27, sentAt: minutes(-1), items: [...swap].reverse() };
  const ownOf = (writes: (typeof write)[]) =>
    pairedWith(matchAppLineupWrites([edit], writes), edit);

  it("finds the app's own write: same team, day and moves, sent within 15 minutes", () => {
    expect(ownOf([write])).toBe(write);
    expect(ownOf([{ ...write, sentAt: minutes(-16) }])).toBe(null);
  });

  it("never takes another team's, another day's or other moves for it", () => {
    const otherSlot = [starterOut, { playerId: 22, fromSlot: "BE", toSlot: "UTIL" }];
    expect(ownOf([{ ...write, teamId: 5 }])).toBe(null);
    expect(ownOf([{ ...write, scoringPeriodId: 26 }])).toBe(null);
    expect(ownOf([{ ...write, items: otherSlot }])).toBe(null);
    expect(ownOf([{ ...write, items: swap.slice(0, 1) }])).toBe(null);
  });

  // B14, 2026-11-14: the same swap on ESPN at 02:26:59Z and 02:29:04Z, the app's write at 02:29:04.
  it("takes one edit for each write, the closest in time, so a second identical edit stays unaccounted for", () => {
    const earlier = { ...edit, at: minutes(-2) };
    const sent = { ...write, sentAt: at };
    const pairs = matchAppLineupWrites([earlier, edit], [sent]);
    expect(pairedWith(pairs, edit)).toBe(sent);
    expect(pairedWith(pairs, earlier)).toBe(null);
  });
});

const completion: ByHandCompletion = {
  requestId: "request-1",
  teamId: 4,
  matchupId: 29,
  completedAt: minutes(5),
  plan: swap,
  finalAdjustmentTenths: -51,
};

// Dec-D31a: only an exact match is the commissioner's own settle.
describe("matchByHandCompletions", () => {
  const settleOf = (observed: ObservedLmEdit, completions: ByHandCompletion[]) =>
    pairedWith(matchByHandCompletions([observed], completions), observed);

  it("matches the commissioner's by-hand edit: same team and moves, within minutes of the completion", () => {
    const markedDoneFirst = { ...completion, completedAt: minutes(-14) };
    expect(settleOf(edit, [completion])).toBe(completion);
    expect(settleOf(edit, [markedDoneFirst])).toBe(markedDoneFirst);
    expect(settleOf(edit, [{ ...completion, completedAt: minutes(16) }])).toBe(null);
  });

  it("takes an edit differing in any slot, or on another team, as not the completion's", () => {
    const otherSlot = {
      ...edit,
      items: [starterOut, { playerId: 22, fromSlot: "BE", toSlot: "C" }],
    };
    expect(settleOf(otherSlot, [completion])).toBe(null);
    expect(settleOf({ ...edit, teamId: 5 }, [completion])).toBe(null);
    expect(settleOf(edit, [{ ...completion, plan: null }])).toBe(null);
  });

  it("takes one edit for each completion, the closest in time", () => {
    const earlier = { ...edit, at: minutes(-3) };
    const pairs = matchByHandCompletions([earlier, edit], [completion]);
    expect(pairedWith(pairs, edit)).toBe(completion);
    expect(pairedWith(pairs, earlier)).toBe(null);
  });
});

describe("inverseLineupMoves", () => {
  it("undoes an edit with its moves swapped, in reverse order", () => {
    expect(inverseLineupMoves(swap)).toEqual([
      { playerId: 22, fromSlot: "F/C", toSlot: "BE" },
      { playerId: 11, fromSlot: "BE", toSlot: "F/C" },
    ]);
  });
});

// Dec-D15: the owner's team-1 edit of 2026-11-03 00:43Z.
describe("isKnownOwnerEdit", () => {
  it("knows the owner's team-1 edit at 00:43Z on 2026-11-03, and nothing else", () => {
    expect(isKnownOwnerEdit({ teamId: 1, at: new Date("2026-11-03T00:43:20.000Z") })).toBe(true);
    expect(isKnownOwnerEdit({ teamId: 2, at: new Date("2026-11-03T00:43:20.000Z") })).toBe(false);
    expect(isKnownOwnerEdit({ teamId: 1, at: new Date("2026-11-03T00:44:00.000Z") })).toBe(false);
  });
});

const adjustment: ObservedAdjustment = {
  teamId: 4,
  matchupId: 29,
  at,
  deltaTenths: -51,
  reason: "Injury sub requested Sun 11/15, 11:00 AM PT: B for A, -5.1",
};

describe("matchAppAdjustmentWrites", () => {
  const write = { teamId: 4, matchupId: 29, sentAt: minutes(-1), reason: adjustment.reason };
  const ownOf = (writes: (typeof write)[]) =>
    pairedWith(matchAppAdjustmentWrites([adjustment], writes), adjustment);

  it("finds the app's own adjustment by its team, matchup and the reason it wrote", () => {
    expect(ownOf([write])).toBe(write);
    expect(ownOf([{ ...write, reason: "Another" }])).toBe(null);
    expect(ownOf([{ ...write, matchupId: 30 }])).toBe(null);
    expect(ownOf([{ ...write, sentAt: minutes(-16) }])).toBe(null);
  });

  it("takes one adjustment for each write, the closest in time", () => {
    const earlier = { ...adjustment, at: minutes(-5) };
    const pairs = matchAppAdjustmentWrites([earlier, adjustment], [write]);
    expect(pairedWith(pairs, adjustment)).toBe(write);
    expect(pairedWith(pairs, earlier)).toBe(null);
  });
});

// The by-hand settle sets the adjustment as well as the lineup: the same exact-match rule.
describe("matchByHandAdjustments", () => {
  const settleOf = (observed: ObservedAdjustment) =>
    pairedWith(matchByHandAdjustments([observed], [completion]), observed);

  it("matches the amount the completion applied, on its team and matchup, within minutes", () => {
    expect(settleOf(adjustment)).toBe(completion);
    expect(settleOf({ ...adjustment, deltaTenths: -50 })).toBe(null);
    expect(settleOf({ ...adjustment, matchupId: 30 })).toBe(null);
  });

  it("takes one adjustment for each completion, the closest in time", () => {
    const later = { ...adjustment, at: minutes(9) };
    const pairs = matchByHandAdjustments([adjustment, later], [completion]);
    expect(pairedWith(pairs, later)).toBe(completion);
    expect(pairedWith(pairs, adjustment)).toBe(null);
  });
});

describe("adjustmentMismatch", () => {
  const settled = (overrides: Partial<LedgerRequest>): LedgerRequest => ({
    teamId: 4,
    matchupId: 29,
    kind: "substitution",
    status: "completed",
    isRehearsal: false,
    finalAdjustmentTenths: -51,
    updatedAt: minutes(-30),
    ...overrides,
  });
  // When the pass began, before it read ESPN's side.
  const readStartedAt = at;
  const side = (actualTenths: number, requests: LedgerRequest[]) =>
    adjustmentMismatch({ teamId: 4, matchupId: 29, actualTenths, requests, readStartedAt });

  // A proving run's token is on its side between the token's write and the revert.
  it("leaves a side alone while a proving run on it is in progress, or stopped with its token on", () => {
    for (const status of ["executing", "needs_review"]) {
      const requests = [settled({ kind: "proving", status, finalAdjustmentTenths: null })];
      expect(side(1, requests)).toBe(null);
    }
  });

  // The executor may write and settle between the pass's read of ESPN and its read of the app's
  // records, so ESPN's side may not show what the records already do.
  it("leaves a side alone when one of its requests changed after the pass began", () => {
    expect(side(0, [settled({ updatedAt: minutes(0.1) })])).toBe(null);
    expect(side(0, [settled({ updatedAt: readStartedAt })])).toBe(null);
    expect(side(0, [settled({ updatedAt: minutes(-0.1) })])).toEqual({
      expectedTenths: -51,
      actualTenths: 0,
    });
  });

  it("expects the sum the side's settled requests applied, and reports a side unlike it", () => {
    const requests = [
      settled({}),
      settled({ status: "completed_manually", finalAdjustmentTenths: 20 }),
    ];

    expect(side(-31, requests)).toBe(null);
    expect(side(-40, requests)).toEqual({ expectedTenths: -31, actualTenths: -40 });
  });

  it("counts no proving run, rehearsal, reversal, or another side's request", () => {
    const requests = [
      settled({ kind: "proving" }),
      settled({ isRehearsal: true }),
      settled({ status: "reversed" }),
      settled({ teamId: 5 }),
      settled({ matchupId: 30 }),
    ];

    expect(side(0, requests)).toBe(null);
  });

  it("leaves a side alone while one of its requests is in progress or with the commissioner", () => {
    for (const status of ["executing", "needs_review"]) {
      const requests = [settled({}), settled({ status, finalAdjustmentTenths: null })];
      expect(side(0, requests)).toBe(null);
    }
  });
});
