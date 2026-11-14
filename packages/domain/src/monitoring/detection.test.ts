import { describe, expect, it } from "vitest";
import {
  adjustmentMismatch,
  type ByHandCompletion,
  findAppAdjustmentWrite,
  findAppLineupWrite,
  findByHandAdjustment,
  findByHandCompletion,
  inverseLineupMoves,
  isKnownOwnerEdit,
  type LedgerRequest,
  type ObservedAdjustment,
  type ObservedLmEdit,
} from "./detection";

const at = new Date("2026-11-15T20:00:00.000Z");
const minutes = (count: number) => new Date(at.getTime() + count * 60_000);
const starterOut = { playerId: 11, fromSlot: "F/C", toSlot: "BE" };
const swap = [starterOut, { playerId: 22, fromSlot: "BE", toSlot: "F/C" }];
const edit: ObservedLmEdit = { teamId: 4, scoringPeriodId: 27, at, items: swap };

describe("findAppLineupWrite", () => {
  const write = { teamId: 4, scoringPeriodId: 27, sentAt: minutes(-1), items: [...swap].reverse() };

  it("finds the app's own write: same team, day and moves, sent within 15 minutes", () => {
    expect(findAppLineupWrite(edit, [write])).toBe(write);
    expect(findAppLineupWrite(edit, [{ ...write, sentAt: minutes(-16) }])).toBe(null);
  });

  it("never takes another team's, another day's or other moves for it", () => {
    const otherSlot = [starterOut, { playerId: 22, fromSlot: "BE", toSlot: "UTIL" }];
    expect(findAppLineupWrite(edit, [{ ...write, teamId: 5 }])).toBe(null);
    expect(findAppLineupWrite(edit, [{ ...write, scoringPeriodId: 26 }])).toBe(null);
    expect(findAppLineupWrite(edit, [{ ...write, items: otherSlot }])).toBe(null);
    expect(findAppLineupWrite(edit, [{ ...write, items: swap.slice(0, 1) }])).toBe(null);
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
describe("findByHandCompletion", () => {
  it("matches the commissioner's by-hand edit: same team and moves, within minutes of the completion", () => {
    const markedDoneFirst = { ...completion, completedAt: minutes(-14) };
    expect(findByHandCompletion(edit, [completion])).toBe(completion);
    expect(findByHandCompletion(edit, [markedDoneFirst])).toBe(markedDoneFirst);
    expect(findByHandCompletion(edit, [{ ...completion, completedAt: minutes(16) }])).toBe(null);
  });

  it("takes an edit differing in any slot, or on another team, as not the completion's", () => {
    const otherSlot = {
      ...edit,
      items: [starterOut, { playerId: 22, fromSlot: "BE", toSlot: "C" }],
    };
    expect(findByHandCompletion(otherSlot, [completion])).toBe(null);
    expect(findByHandCompletion({ ...edit, teamId: 5 }, [completion])).toBe(null);
    expect(findByHandCompletion(edit, [{ ...completion, plan: null }])).toBe(null);
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

describe("findAppAdjustmentWrite", () => {
  const write = { teamId: 4, matchupId: 29, sentAt: minutes(-1), reason: adjustment.reason };

  it("finds the app's own adjustment by its team, matchup and the reason it wrote", () => {
    expect(findAppAdjustmentWrite(adjustment, [write])).toBe(write);
    expect(findAppAdjustmentWrite(adjustment, [{ ...write, reason: "Another" }])).toBe(null);
    expect(findAppAdjustmentWrite(adjustment, [{ ...write, matchupId: 30 }])).toBe(null);
    expect(findAppAdjustmentWrite(adjustment, [{ ...write, sentAt: minutes(-16) }])).toBe(null);
  });
});

// The by-hand settle sets the adjustment as well as the lineup: the same exact-match rule.
describe("findByHandAdjustment", () => {
  it("matches the amount the completion applied, on its team and matchup, within minutes", () => {
    expect(findByHandAdjustment(adjustment, [completion])).toBe(completion);
    expect(findByHandAdjustment({ ...adjustment, deltaTenths: -50 }, [completion])).toBe(null);
    expect(findByHandAdjustment({ ...adjustment, matchupId: 30 }, [completion])).toBe(null);
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
    ...overrides,
  });

  it("expects the sum the side's settled requests applied, and reports a side unlike it", () => {
    const requests = [
      settled({}),
      settled({ status: "completed_manually", finalAdjustmentTenths: 20 }),
    ];

    expect(adjustmentMismatch({ teamId: 4, matchupId: 29, actualTenths: -31, requests })).toBe(
      null
    );
    expect(adjustmentMismatch({ teamId: 4, matchupId: 29, actualTenths: -40, requests })).toEqual({
      expectedTenths: -31,
      actualTenths: -40,
    });
  });

  it("counts no proving run, rehearsal, reversal, or another side's request", () => {
    const requests = [
      settled({ kind: "proving" }),
      settled({ isRehearsal: true }),
      settled({ status: "reversed" }),
      settled({ teamId: 5 }),
      settled({ matchupId: 30 }),
    ];

    expect(adjustmentMismatch({ teamId: 4, matchupId: 29, actualTenths: 0, requests })).toBe(null);
  });

  it("leaves a side alone while one of its requests is in progress or with the commissioner", () => {
    for (const status of ["executing", "needs_review"]) {
      const requests = [settled({}), settled({ status, finalAdjustmentTenths: null })];
      expect(adjustmentMismatch({ teamId: 4, matchupId: 29, actualTenths: 0, requests })).toBe(
        null
      );
    }
  });
});
