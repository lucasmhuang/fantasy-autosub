import { describe, expect, it } from "vitest";
import {
  createSignInCodeExpiresAt,
  decideSignInCodeSend,
  formatSignInCode,
  hashSignInCode,
  normalizeSubmittedCode,
  signInCodeHashesMatch,
} from "./sign-in-code";

const now = new Date("2026-11-03T12:00:00.000Z");
const secret = "a-test-secret-that-is-32-chars-!";

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

describe("sign-in codes", () => {
  it("formats a code as six digits, keeping leading zeros", () => {
    expect(formatSignInCode(0)).toBe("000000");
    expect(formatSignInCode(42)).toBe("000042");
    expect(formatSignInCode(999999)).toBe("999999");
  });

  it("strips whitespace from a submitted code", () => {
    expect(normalizeSubmittedCode("123 456")).toBe("123456");
    expect(normalizeSubmittedCode(" 000042\n")).toBe("000042");
  });

  it.each([
    "12345",
    "1234567",
    "12a456",
    "",
    123456,
    null,
  ])("refuses %j as a submitted code", (raw) => {
    expect(normalizeSubmittedCode(raw)).toBeNull();
  });

  it("hashes a code to 64 hex characters, the same way each time, without the code in it", () => {
    const input = { secret, userId: "user-a", code: "123456" };
    const hash = hashSignInCode(input);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSignInCode(input)).toBe(hash);
    expect(hash).not.toContain("123456");
  });

  it("hashes the same code differently for another user or another secret", () => {
    const hash = hashSignInCode({ secret, userId: "user-a", code: "123456" });

    expect(hashSignInCode({ secret, userId: "user-b", code: "123456" })).not.toBe(hash);
    expect(hashSignInCode({ secret: `${secret}x`, userId: "user-a", code: "123456" })).not.toBe(
      hash
    );
  });

  it("matches only an identical hash, and doesn't throw on a shorter one", () => {
    const hash = hashSignInCode({ secret, userId: "user-a", code: "123456" });
    const other = hashSignInCode({ secret, userId: "user-a", code: "654321" });

    expect(signInCodeHashesMatch(hash, hash)).toBe(true);
    expect(signInCodeHashesMatch(hash, other)).toBe(false);
    expect(signInCodeHashesMatch(hash, hash.slice(0, 10))).toBe(false);
  });

  it("expires a code the given number of minutes after it's made", () => {
    expect(createSignInCodeExpiresAt(now, 10).toISOString()).toBe("2026-11-03T12:10:00.000Z");
  });
});

describe("decideSignInCodeSend", () => {
  it("allows a third code within 15 minutes", () => {
    expect(decideSignInCodeSend([minutesAgo(9), minutesAgo(2)], now)).toEqual({ allowed: true });
  });

  it("refuses a fourth code within 15 minutes until the oldest of the three is 15 minutes old", () => {
    const sentAt = [minutesAgo(9.5), minutesAgo(5), minutesAgo(2)];

    expect(decideSignInCodeSend(sentAt, now)).toEqual({ allowed: false, retryAfterMinutes: 6 });
  });

  it("doesn't count a code sent exactly 15 minutes ago", () => {
    const sentAt = [minutesAgo(15), minutesAgo(5), minutesAgo(2)];

    expect(decideSignInCodeSend(sentAt, now)).toEqual({ allowed: true });
  });

  it("allows a tenth code in 24 hours, and refuses an eleventh until the oldest is a day old", () => {
    const hourly = (count: number) =>
      Array.from({ length: count }, (_, index) => minutesAgo(60 * (index + 1)));

    expect(decideSignInCodeSend(hourly(9), now)).toEqual({ allowed: true });
    expect(decideSignInCodeSend(hourly(10), now)).toEqual({
      allowed: false,
      retryAfterMinutes: 24 * 60 - 600,
    });
  });

  it("gives the longer wait when both windows are full", () => {
    const earlier = Array.from({ length: 7 }, (_, index) => minutesAgo(60 * (14 + index)));
    const sentAt = [...earlier, minutesAgo(10), minutesAgo(5), minutesAgo(1)];

    // The 15-minute window frees in 5 minutes; the day window only when the code sent 20 hours ago
    // turns a day old.
    expect(decideSignInCodeSend(sentAt, now)).toEqual({
      allowed: false,
      retryAfterMinutes: 4 * 60,
    });
  });
});
