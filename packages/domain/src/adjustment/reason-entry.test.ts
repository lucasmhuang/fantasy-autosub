import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_REASON_MAX_LENGTH,
  adjustmentReasonEntry,
  amountInReasonEntry,
  findRequestEntry,
} from "./reason-entry";

const request = {
  // 7:10 PM Pacific on Tue 10/27, past midnight UTC.
  requestMoment: new Date("2026-10-28T02:10:00Z"),
  injuredName: "Jaren Jackson Jr.",
  replacementName: "Toumani Camara",
};

describe("adjustmentReasonEntry", () => {
  it("names the request's Pacific moment, the replacement for the starter, and the signed amount", () => {
    expect(adjustmentReasonEntry(request, 51)).toBe(
      "Injury sub requested Tue, 10/27, 7:10 PM PT: Toumani Camara for Jaren Jackson Jr., +5.1"
    );
  });

  it("writes a deduction with its minus sign", () => {
    expect(adjustmentReasonEntry(request, -404)).toMatch(/, -40\.4$/);
  });
});

describe("ADJUSTMENT_REASON_MAX_LENGTH", () => {
  it("is the 1,000 characters ESPN stored whole on team 1", () => {
    expect(ADJUSTMENT_REASON_MAX_LENGTH).toBe(1_000);
  });
});

describe("amountInReasonEntry", () => {
  it("reads back the amount an entry was written with", () => {
    expect(amountInReasonEntry(adjustmentReasonEntry(request, 51))).toBe(51);
    expect(amountInReasonEntry(adjustmentReasonEntry(request, -404))).toBe(-404);
  });

  it("finds no amount in a reason the app didn't write", () => {
    expect(amountInReasonEntry("LM: stat fix")).toBe(null);
  });
});

describe("findRequestEntry", () => {
  it("finds the request's entry in a side's reason, whatever amount it carries", () => {
    const entry = adjustmentReasonEntry(request, -300);
    expect(findRequestEntry(`LM: stat fix | ${entry}`, request)).toBe(entry);
  });

  it("finds nothing in a reason that names only another request", () => {
    const other = { ...request, replacementName: "Jake Larsson" };
    expect(findRequestEntry(adjustmentReasonEntry(other, 51), request)).toBe(null);
  });
});
