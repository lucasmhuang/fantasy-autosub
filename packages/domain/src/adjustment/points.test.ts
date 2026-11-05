import { describe, expect, it } from "vitest";
import { calculateFantasyPoints } from "../scoring/formula";
import { formatTenths, toTenths } from "./points";

const noStats = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };

describe("toTenths", () => {
  it("keeps a 1.2 × 7 rebound line exact", () => {
    // 1.2 * 7 is 8.399999999999999 as a float.
    expect(toTenths(calculateFantasyPoints({ ...noStats, reb: 7 }))).toBe(84);
  });

  it("rounds ESPN's float totals to the tenth they stand for", () => {
    expect(toTenths(17.700000000000003)).toBe(177);
    expect(toTenths(-12.6)).toBe(-126);
  });

  it("never gives negative zero", () => {
    expect(Object.is(toTenths(-0.01), 0)).toBe(true);
  });

  it("refuses a value that isn't a finite number", () => {
    expect(() => toTenths(Number.NaN)).toThrow(RangeError);
    expect(() => toTenths(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatTenths", () => {
  it("writes tenths as points with one decimal", () => {
    expect(formatTenths(51)).toBe("5.1");
    expect(formatTenths(-126)).toBe("-12.6");
    expect(formatTenths(7)).toBe("0.7");
    expect(formatTenths(0)).toBe("0.0");
  });

  it("marks a positive amount with + when asked", () => {
    expect(formatTenths(177, { signed: true })).toBe("+17.7");
    expect(formatTenths(-80, { signed: true })).toBe("-8.0");
    expect(formatTenths(0, { signed: true })).toBe("0.0");
  });
});
