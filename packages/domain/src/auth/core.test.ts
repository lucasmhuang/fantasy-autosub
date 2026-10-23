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

describe("resolveSafeRedirectPath", () => {
  it.each([
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "///evil.example",
    "\\\\evil.example",
    "\\/evil.example",
    "/\\/evil.example",
    "/\\a b",
    "//a b",
    "//redirect-check.invalid/x",
    "/\\redirect-check.invalid/x",
    "HTTP://evil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    "evil.example",
    "page/1",
    "http://localhost:3000/app",
    " //evil.example",
    "/a\nb",
    "/a\r\nSet-Cookie: x=1",
    "/app/✓",
    "/／evil.example",
    "/​/evil.example",
    "/café",
    "",
    null,
    undefined,
  ])("sends %j to the default page", (redirectPath) => {
    expect(resolveSafeRedirectPath(redirectPath)).toBe("/app");
  });

  it("sends a repeated redirect parameter to the default page", () => {
    expect(resolveSafeRedirectPath(["/a", "/b"])).toBe("/app");
  });

  it.each([
    "/commish/requests",
    "/app?week=3&tab=bench",
    "/app?q=a%26b#bench",
    "/app#bench",
    "/auth/magic/abc123",
    "/%5Cevil.example",
  ])("keeps %j exactly as given", (redirectPath) => {
    expect(resolveSafeRedirectPath(redirectPath)).toBe(redirectPath);
  });
});
