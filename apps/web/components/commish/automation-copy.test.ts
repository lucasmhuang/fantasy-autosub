import { describe, expect, it } from "vitest";
import type { PageAutomation } from "../../lib/server/commish-alerts";
import { automationWords, restoreHint } from "./automation-copy";

const reading = { zone: "America/Los_Angeles", now: new Date("2026-11-17T05:00:00.000Z") };
const t = new Date("2026-11-17T04:10:00.000Z");

describe("automationWords", () => {
  const of = (automation: PageAutomation) => automationWords(automation, reading);

  it("is on with its mode and teams, and its switch turns it off", () => {
    expect(of({ status: "on", mode: "approval_required", teamCount: 12, changedAt: null })).toEqual(
      {
        on: true,
        detail: "approval required, 12 teams",
        action: "/commish/automation/off",
        notice: null,
      }
    );
  });

  it("is off, says since when, and its switch turns it back on", () => {
    expect(of({ status: "switched_off", mode: "auto", teamCount: 3, changedAt: t })).toEqual({
      on: false,
      detail: "every request goes to Needs you",
      action: "/commish/automation/on",
      notice: "Turned off 8:10 PM PT. Requests already in line stop before anything is sent.",
    });
  });

  it("has no switch when it was turned off in Settings", () => {
    expect(of({ status: "off", changedAt: null })).toEqual({
      on: false,
      detail: "every request goes to Needs you",
      action: undefined,
      notice: "Requests already in line stop before anything is sent.",
    });
  });
});

describe("automationWords, unread", () => {
  it("says it can't be read, with no switch and no notice", () => {
    expect(automationWords({ status: "unavailable" }, reading)).toEqual({
      on: false,
      unread: true,
      detail: "can't be read right now",
      action: undefined,
      notice: null,
    });
  });
});

// FS-SETTINGS-6: near the switch, what switching back on restores.
describe("restoreHint", () => {
  it.for([
    [
      { status: "switched_off", mode: "approval_required", teamCount: 12, changedAt: t },
      "Switching it back on restores approval required for 12 teams.",
    ],
    [
      { status: "switched_off", mode: "auto", teamCount: 1, changedAt: t },
      "Switching it back on restores auto for 1 team.",
    ],
    [{ status: "on", mode: "auto", teamCount: 3, changedAt: null }, null],
    [{ status: "off", changedAt: null }, null],
  ] as const)("says %o as %s", ([automation, hint]) => {
    expect(restoreHint(automation)).toBe(hint);
  });
});
