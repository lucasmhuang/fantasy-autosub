import { describe, expect, it } from "vitest";
import {
  createSessionExpiresAt,
  getDefaultSignedInPath,
  hashSessionToken,
  isSameOriginRequest,
  isSessionActive,
  normalizeEmailAddress,
  parseEmailAddress,
  resolveSafeRedirectPath,
  shouldRenewSession,
} from "./core";

describe("auth core helpers", () => {
  it("normalizes email addresses", () => {
    expect(normalizeEmailAddress("  Manager@Example.COM ")).toBe("manager@example.com");
  });

  it("trims and lowercases an email address before checking it", () => {
    expect(parseEmailAddress(" Manager@Example.com ")).toBe("manager@example.com");
  });

  it.each(["", "   ", "no-at-sign", 42, null])("refuses %j as an email address", (raw) => {
    expect(parseEmailAddress(raw)).toBeNull();
  });

  it("computes session expirations", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");

    expect(createSessionExpiresAt(now, 90).toISOString()).toBe("2026-07-03T12:00:00.000Z");
  });

  it("recognizes active sessions", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");

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
  });

  it("starts anyone with a team on /app, and a commissioner without one on the requests page", () => {
    expect(getDefaultSignedInPath("manager", 3)).toBe("/app");
    expect(getDefaultSignedInPath("commissioner", 1)).toBe("/app");
    expect(getDefaultSignedInPath("commissioner", null)).toBe("/commish/requests");
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

describe("session tokens", () => {
  // Stored session ids are these hashes, so a change of algorithm would sign everyone out. The
  // expected value is FIPS 180-2's SHA-256 test vector for "abc".
  it("hashes a session token with SHA-256, as hex", () => {
    expect(hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("renews a session last seen more than 24 hours ago", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    const hoursAgo = (hours: number, extraSeconds = 0) =>
      new Date(now.getTime() - hours * 3_600_000 - extraSeconds * 1000);

    expect(shouldRenewSession(hoursAgo(24, -1), now)).toBe(false);
    expect(shouldRenewSession(hoursAgo(24), now)).toBe(false);
    expect(shouldRenewSession(hoursAgo(24, 1), now)).toBe(true);
  });
});

describe("isSameOriginRequest", () => {
  it("accepts a form POST from the app's own origin", () => {
    expect(isSameOriginRequest("https://injurysub.com", "https://injurysub.com")).toBe(true);
    expect(isSameOriginRequest("https://injurysub.com", "https://injurysub.com/")).toBe(true);
    expect(isSameOriginRequest("http://localhost:3000", "http://localhost:3000")).toBe(true);
  });

  it.each([
    "https://injurysub.com/",
    "https://injurysub.com/login",
    "http://injurysub.com",
    "https://injurysub.com:8443",
    "https://evil.example",
    "https://injurysub.com.evil.example",
    "null",
    null,
  ])("refuses a form POST whose Origin is %j", (origin) => {
    expect(isSameOriginRequest(origin, "https://injurysub.com")).toBe(false);
  });
});
