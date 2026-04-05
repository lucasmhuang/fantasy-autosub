import { describe, expect, it } from "vitest";
import {
  createMagicLinkExpiresAt,
  createSessionExpiresAt,
  getDefaultSignedInPath,
  isMagicLinkActive,
  isSessionActive,
  normalizeEmailAddress,
  resolveSafeRedirectPath,
} from "./core";

describe("auth core helpers", () => {
  it("normalizes email addresses", () => {
    expect(normalizeEmailAddress("  Manager@Example.COM ")).toBe("manager@example.com");
  });

  it("computes magic-link and session expirations", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");

    expect(createMagicLinkExpiresAt(now, 15).toISOString()).toBe("2026-04-04T12:15:00.000Z");
    expect(createSessionExpiresAt(now, 90).toISOString()).toBe("2026-07-03T12:00:00.000Z");
  });

  it("recognizes active magic links and sessions", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");

    expect(isMagicLinkActive("active", new Date("2026-04-04T12:15:00.000Z"), null, now)).toBe(true);
    expect(isMagicLinkActive("used", new Date("2026-04-04T12:15:00.000Z"), null, now)).toBe(false);
    expect(isSessionActive(new Date("2026-04-05T12:00:00.000Z"), null, now)).toBe(true);
    expect(
      isSessionActive(
        new Date("2026-04-05T12:00:00.000Z"),
        new Date("2026-04-04T12:01:00.000Z"),
        now
      )
    ).toBe(false);
  });

  it("keeps redirect paths internal", () => {
    expect(resolveSafeRedirectPath("/commish/requests")).toBe("/commish/requests");
    expect(resolveSafeRedirectPath("https://evil.example")).toBe("/app");
    expect(resolveSafeRedirectPath("//evil.example")).toBe("/app");
    expect(getDefaultSignedInPath("manager")).toBe("/app");
    expect(getDefaultSignedInPath("commissioner")).toBe("/commish/requests");
  });
});
