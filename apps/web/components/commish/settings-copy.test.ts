import { describe, expect, it } from "vitest";
import { provingText, settingsNotice } from "./settings-copy";

const reading = { zone: "America/Los_Angeles", now: new Date("2026-11-19T03:00:00.000Z") };
const savedAt = new Date("2026-11-19T02:45:00.000Z");

describe("the settings page's notices (IF-SETTINGS-1, FM-SETTINGS-1)", () => {
  it("says when the settings were saved", () => {
    expect(settingsNotice("saved", savedAt, reading)).toEqual({
      tone: "info",
      text: "Saved Wed 6:45 PM PT.",
    });
  });

  it("says another tab changed them, and when", () => {
    expect(settingsNotice("settings_changed", savedAt, reading)).toEqual({
      tone: "wait",
      text: "Settings changed in another tab at Wed 6:45 PM PT. These are the current ones; make your change again.",
    });
  });

  it("leaves any other status to the commissioner's own messages", () => {
    expect(settingsNotice("invalid_form", savedAt, reading)).toBeNull();
    expect(settingsNotice("saved", null, reading)).toEqual({ tone: "info", text: "Saved." });
  });
});

describe("proving on the settings page (FS-SETTINGS-5)", () => {
  it("says it isn't done, or when it was", () => {
    expect(provingText(null, reading.zone)).toBe(
      "Not done. Run it once before ticking other teams."
    );
    expect(provingText(new Date("2026-11-19T18:12:00.000Z"), reading.zone)).toBe(
      "Done Thu Nov 19, 10:12 AM PT."
    );
  });
});
