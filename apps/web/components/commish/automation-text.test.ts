import { describe, expect, it } from "vitest";
import { automationSwitchText } from "./automation-text";

describe("automationSwitchText", () => {
  it("offers to switch automation off while it's on", () => {
    expect(automationSwitchText({ status: "on", mode: "auto", teamCount: 1 })).toEqual({
      line: "Automation is on: auto for 1 team.",
      action: { path: "/commish/automation/off", label: "Turn automation off" },
    });
  });

  // Dec-D31e's wording.
  it("says what switching back on restores", () => {
    expect(
      automationSwitchText({ status: "switched_off", mode: "approval_required", teamCount: 12 })
    ).toEqual({
      line: "Automation is off. Switching it back on restores approval required for 12 teams.",
      action: { path: "/commish/automation/on", label: "Turn automation back on" },
    });
  });

  it("sends automation off in the settings to the settings, and says when it can't be read", () => {
    expect(automationSwitchText({ status: "off" })).toEqual({
      line: "Automation is off: no team is checked in the settings.",
      action: null,
    });
    expect(automationSwitchText({ status: "unavailable" }).action).toBeNull();
  });
});
