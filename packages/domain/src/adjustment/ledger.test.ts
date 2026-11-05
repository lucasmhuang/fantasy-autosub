import { describe, expect, it } from "vitest";
import { composeReason, targetSideAdjustment } from "./ledger";

describe("targetSideAdjustment", () => {
  it("adds the delta to the side's existing adjustment, since ESPN sets the value it's sent", () => {
    expect(targetSideAdjustment(51, -30)).toBe(21);
    expect(targetSideAdjustment(0, 51)).toBe(51);
  });
});

describe("composeReason", () => {
  it("starts the reason with the first substitution's entry", () => {
    expect(composeReason("", "Sub A +5.1", 100)).toEqual({ ok: true, reason: "Sub A +5.1" });
  });

  it("keeps every substitution behind the side's total, newest last", () => {
    expect(composeReason("Sub A +5.1", "Sub B -3.0", 100)).toEqual({
      ok: true,
      reason: "Sub A +5.1 | Sub B -3.0",
    });
  });

  it("keeps a reason someone else wrote, ahead of the new entry", () => {
    expect(composeReason("LM: stat fix", "Sub A +5.1", 100)).toEqual({
      ok: true,
      reason: "LM: stat fix | Sub A +5.1",
    });
  });

  it("doesn't add an entry the reason already holds, so a retried write can't repeat it", () => {
    expect(composeReason("Sub A +5.1 | Sub B -3.0", "Sub A +5.1", 100)).toEqual({
      ok: true,
      reason: "Sub A +5.1 | Sub B -3.0",
    });
  });

  it("fits a reason exactly at the cap, and refuses one past it rather than dropping a substitution", () => {
    expect(composeReason("Sub A +5.1", "Sub B -3.0", 23)).toEqual({
      ok: true,
      reason: "Sub A +5.1 | Sub B -3.0",
    });
    expect(composeReason("Sub A +5.1", "Sub B -3.0", 22)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});
