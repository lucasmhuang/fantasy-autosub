import { describe, expect, it } from "vitest";
import { zoneToReport } from "./zone-report";

describe("zoneToReport", () => {
  it("reports the device's zone when the session holds none", () => {
    expect(zoneToReport("America/New_York", null)).toBe("America/New_York");
  });

  it("reports the device's zone when the session holds another", () => {
    expect(zoneToReport("America/Chicago", "America/New_York")).toBe("America/Chicago");
  });

  it("reports nothing when the session already holds the device's zone, by any of its names", () => {
    expect(zoneToReport("America/New_York", "America/New_York")).toBeNull();
    expect(zoneToReport("US/Eastern", "America/New_York")).toBeNull();
  });

  it("reports nothing when the browser names no zone", () => {
    expect(zoneToReport("", null)).toBeNull();
  });
});
