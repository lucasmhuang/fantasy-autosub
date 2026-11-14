import { describe, expect, it } from "vitest";
import { inverseEdit, PROVING_REASON_ENTRY, planProvingToken } from "./proving";

describe("inverseEdit", () => {
  it("undoes a direct swap: the replacement back to the bench, then the starter back", () => {
    const swap = [
      { playerId: 4, fromSlot: "F", toSlot: "BE" },
      { playerId: 20, fromSlot: "BE", toSlot: "F" },
    ];

    expect(inverseEdit(swap)).toEqual([
      { playerId: 20, fromSlot: "F", toSlot: "BE" },
      { playerId: 4, fromSlot: "BE", toSlot: "F" },
    ]);
  });

  it("undoes a one-move rearrangement in reverse order, so each slot is free when its item applies", () => {
    const rearrangement = [
      { playerId: 7, fromSlot: "C", toSlot: "BE" },
      { playerId: 10, fromSlot: "UTIL", toSlot: "C" },
      { playerId: 20, fromSlot: "BE", toSlot: "UTIL" },
    ];

    expect(inverseEdit(rearrangement)).toEqual([
      { playerId: 20, fromSlot: "UTIL", toSlot: "BE" },
      { playerId: 10, fromSlot: "C", toSlot: "UTIL" },
      { playerId: 7, fromSlot: "BE", toSlot: "C" },
    ]);
  });
});

describe("planProvingToken", () => {
  it("adds 0.1 and the test note to an untouched side, keeping what to put back", () => {
    expect(planProvingToken({ currentTenths: 0, currentReason: "" }, 1_000)).toEqual({
      ok: true,
      targetTenths: 1,
      reason: "InjurySub test (reverted)",
      original: { tenths: 0, reason: "" },
    });
  });

  it("adds the test note beside a real request's entries, which the revert puts back unchanged", () => {
    const currentReason =
      "Injury sub: Larsson for Tatum, -40.4 | Injury sub: Fears for Lillard, +5.1";

    expect(planProvingToken({ currentTenths: -353, currentReason }, 1_000)).toEqual({
      ok: true,
      targetTenths: -352,
      reason: `${currentReason} | ${PROVING_REASON_ENTRY}`,
      original: { tenths: -353, reason: currentReason },
    });
  });

  it("refuses a side that still carries an earlier run's test note", () => {
    const currentReason = `Injury sub: Fears for Lillard, +5.1 | ${PROVING_REASON_ENTRY}`;

    expect(planProvingToken({ currentTenths: 52, currentReason }, 1_000)).toEqual({
      ok: false,
      refusal: "already_noted",
    });
  });

  it("refuses a note the test entry would take past ESPN's limit", () => {
    const currentReason = "x".repeat(990);

    expect(planProvingToken({ currentTenths: 0, currentReason }, 1_000)).toEqual({
      ok: false,
      refusal: "too_long",
    });
  });
});
