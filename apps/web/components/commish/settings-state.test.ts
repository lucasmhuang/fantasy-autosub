import { describe, expect, it } from "vitest";
import { allTicked, TEAMS_HELPER, withAllTeams, withTeam } from "./settings-state";

const TEAMS = [1, 2, 3];

describe("the settings form's ticks", () => {
  it("ticks every team with All teams, and none without it", () => {
    expect(withAllTeams(true, TEAMS)).toEqual([1, 2, 3]);
    expect(withAllTeams(false, TEAMS)).toEqual([]);
  });

  it("ticks and unticks one team, keeping the order", () => {
    expect(withTeam([3, 1], 2, true)).toEqual([1, 2, 3]);
    expect(withTeam([1, 2, 3], 2, false)).toEqual([1, 3]);
  });

  it("reads All teams as ticked only when every team is", () => {
    expect(allTicked([1, 2, 3], TEAMS)).toBe(true);
    expect(allTicked([1, 3], TEAMS)).toBe(false);
  });

  // Copy table 3: the helper says what an empty list means; the radios say each mode.
  it("says no team ticked means you settle every request, and repeats no mode", () => {
    expect(TEAMS_HELPER).toBe("No team ticked: you settle every request by hand.");
    expect(TEAMS_HELPER).not.toMatch(/without you|your approval/);
  });
});
