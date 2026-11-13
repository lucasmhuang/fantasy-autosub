import { describe, expect, it } from "vitest";
import { buildLineupTransaction } from "./lineup";

// Synthetic owner id: the real SWID never appears in tests.
const ownerSwid = "{A1B2C3D4-1111-4111-8111-0000000000AA}";

describe("buildLineupTransaction", () => {
  // The body of the 2026-10-29 league-manager edit (team 8), ids replaced: ESPN applied it.
  it("builds the league-manager lineup body ESPN applied on 2026-10-29", () => {
    const body = buildLineupTransaction({
      teamId: 8,
      memberId: ownerSwid,
      scoringPeriodId: 10,
      moves: [
        { playerId: 4277961, fromSlot: "F", toSlot: "BE" },
        { playerId: 4431675, fromSlot: "BE", toSlot: "F" },
      ],
    });

    expect(body).toEqual({
      isLeagueManager: true,
      teamId: 8,
      type: "ROSTER",
      memberId: ownerSwid,
      scoringPeriodId: 10,
      executionType: "EXECUTE",
      items: [
        { playerId: 4277961, type: "LINEUP", fromLineupSlotId: 6, toLineupSlotId: 12 },
        { playerId: 4431675, type: "LINEUP", fromLineupSlotId: 12, toLineupSlotId: 6 },
      ],
      isActingAsTeamOwner: false,
      skipTransactionCounters: false,
    });
  });

  it("braces an owner id given without its braces", () => {
    const body = buildLineupTransaction({
      teamId: 1,
      memberId: "A1B2C3D4-1111-4111-8111-0000000000AA",
      scoringPeriodId: 25,
      moves: [{ playerId: 1, fromSlot: "C", toSlot: "BE" }],
    });

    expect(body.memberId).toBe(ownerSwid);
  });

  // A one-move rearrangement, as lineupMovesFor lists it: the injured starter to the bench, the
  // moved starter, then the replacement from the bench. ESPN applies the items in one edit, and
  // each must find its target slot as the items before it left it, so the order is kept. Here
  // the injured starter holds F/C (id 10) and the mover leaves C (id 4): slot-id order differs.
  it("keeps a one-move rearrangement's three items in the order given", () => {
    const body = buildLineupTransaction({
      teamId: 1,
      memberId: ownerSwid,
      scoringPeriodId: 25,
      moves: [
        { playerId: 101, fromSlot: "F/C", toSlot: "BE" },
        { playerId: 102, fromSlot: "C", toSlot: "F/C" },
        { playerId: 103, fromSlot: "BE", toSlot: "C" },
      ],
    });

    expect(
      body.items.map(({ playerId, fromLineupSlotId, toLineupSlotId }) => ({
        playerId,
        fromLineupSlotId,
        toLineupSlotId,
      }))
    ).toEqual([
      { playerId: 101, fromLineupSlotId: 10, toLineupSlotId: 12 },
      { playerId: 102, fromLineupSlotId: 4, toLineupSlotId: 10 },
      { playerId: 103, fromLineupSlotId: 12, toLineupSlotId: 4 },
    ]);
  });

  it("refuses a slot ESPN has no id for, an empty edit, and an owner id that isn't one", () => {
    const edit = { teamId: 1, memberId: ownerSwid, scoringPeriodId: 25 };

    expect(() =>
      buildLineupTransaction({ ...edit, moves: [{ playerId: 1, fromSlot: "QB", toSlot: "BE" }] })
    ).toThrow(RangeError);
    expect(() => buildLineupTransaction({ ...edit, moves: [] })).toThrow(RangeError);
    expect(() =>
      buildLineupTransaction({
        ...edit,
        memberId: "not-an-id",
        moves: [{ playerId: 1, fromSlot: "C", toSlot: "BE" }],
      })
    ).toThrow(RangeError);
  });
});
