import { describe, expect, it } from "vitest";
import { calculateFantasyPoints } from "./formula";

describe("calculateFantasyPoints", () => {
  it("applies the league scoring weights", () => {
    expect(
      calculateFantasyPoints({
        pts: 24,
        reb: 11,
        ast: 2,
        stl: 1,
        blk: 2,
        tov: 3
      })
    ).toBe(46.2);
  });
});
