import { describe, expect, it } from "vitest";
import { firstName, teamName, teamWithManager } from "./display-names";

// FS-APP-14: every team by its name and every person by first name, with "Team {id}" only while
// no name is known.
describe("teamName", () => {
  it("takes the first name it's given that isn't blank", () => {
    expect(teamName(7, "Stretch Fours", "Older Name")).toBe("Stretch Fours");
    expect(teamName(7, null, undefined, "  ", "Live Name")).toBe("Live Name");
  });

  it('falls back to "Team {id}" when no name is known', () => {
    expect(teamName(7)).toBe("Team 7");
    expect(teamName(7, null, "")).toBe("Team 7");
  });
});

describe("firstName", () => {
  it("cuts a display name to its first word", () => {
    expect(firstName("Marcus Smith")).toBe("Marcus");
    expect(firstName("  Dana  ")).toBe("Dana");
  });

  it("gives null for no name", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("   ")).toBeNull();
  });
});

describe("teamWithManager", () => {
  it('reads "{team} · {first name}" when the team has a manager', () => {
    expect(teamWithManager("Stretch Fours", "Marcus Smith")).toBe("Stretch Fours · Marcus");
  });

  it("is the team alone without one", () => {
    expect(teamWithManager("Stretch Fours", null)).toBe("Stretch Fours");
  });
});
