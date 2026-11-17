import { describe, expect, it } from "vitest";
import { allTicked, teamsHelper, withAllTeams, withTeam } from "./settings-state";

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

  // FS-SETTINGS-2: the helper follows the mode chosen.
  it("says what a ticked team's requests do in each mode", () => {
    expect(teamsHelper("approval_required")).toBe(
      "No team ticked: you settle every request by hand. A ticked team's requests wait for your approval."
    );
    expect(teamsHelper("auto")).toBe(
      "No team ticked: you settle every request by hand. A ticked team's requests run without you."
    );
  });
});
