import { SIGN_IN_CODE_MAX_ATTEMPTS } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import { backNotice, renderStatusMessage } from "./status-messages";

const context = { retryAfterMinutes: null, triesLeft: null };

// The statuses are the ones the request-code, verify-code and logout routes write into /login,
// worded and placed as the canvas draws them (FS-SIGNIN, FM-SIGNIN-1 to -12): a problem with what
// was typed under its field, anything else as a notice above the form.
describe("renderStatusMessage", () => {
  it.each([
    [
      "unknown_email",
      "No account uses this address. Ask your commissioner which email they registered for you.",
    ],
    ["invalid_email", "That doesn't look like an email address."],
  ])("puts %s under the email field", (status, text) => {
    expect(renderStatusMessage(status, "email", context)).toEqual({ place: "field", text });
  });

  it.each([
    ["send_failed", "fail", "We couldn't send your code just now."],
    ["unavailable", "fail", "Something went wrong on our side. Try again in a moment."],
    ["signed_out", "info", "You're signed out on this device."],
  ] as const)("shows %s on the email step as a notice", (status, tone, text) => {
    expect(renderStatusMessage(status, "email", context)).toEqual({ place: "notice", tone, text });
  });

  it("says nothing extra once a code is sent: the page itself says where it went", () => {
    expect(renderStatusMessage("code_sent", "code", context)).toBeNull();
  });

  it("counts the tries left under the code field after a wrong code", () => {
    expect(renderStatusMessage("wrong_code", "code", { ...context, triesLeft: 3 })).toEqual({
      place: "field",
      text: "Wrong code. 3 tries left.",
    });
    expect(renderStatusMessage("wrong_code", "code", { ...context, triesLeft: 1 })).toEqual({
      place: "field",
      text: "Wrong code. 1 try left.",
    });
    expect(renderStatusMessage("wrong_code", "code", context)).toEqual({
      place: "field",
      text: "Wrong code.",
    });
  });

  it.each([
    ["invalid_code", "Enter all 6 digits from the email."],
    [
      "code_expired",
      "This code has expired or was already used. Send a new code; only the newest one works.",
    ],
  ])("puts %s under the code field", (status, text) => {
    expect(renderStatusMessage(status, "code", context)).toEqual({ place: "field", text });
  });

  it.each([
    [
      "too_many_tries",
      "fail",
      `That's ${SIGN_IN_CODE_MAX_ATTEMPTS} wrong tries, so this code no longer works. Send a new code to try again.`,
    ],
    ["send_failed", "fail", "We couldn't send a new code. Your last one still works."],
    ["unavailable", "fail", "Something went wrong on our side. Try again in a moment."],
  ] as const)("shows %s on the code step as a notice", (status, tone, text) => {
    expect(renderStatusMessage(status, "code", context)).toEqual({ place: "notice", tone, text });
  });

  it.each([
    [1, "Code limit reached. Ask again in 1 minute; your newest code still works."],
    [12, "Code limit reached. Ask again in 12 minutes; your newest code still works."],
    [60, "Code limit reached. Ask again in about 1 hour; your newest code still works."],
    [61, "Code limit reached. Ask again in about 2 hours; your newest code still works."],
    [null, "Code limit reached. Ask again later; your newest code still works."],
  ])("says how long to wait %s minutes after too many codes", (retryAfterMinutes, text) => {
    expect(
      renderStatusMessage("too_many_codes", "code", { ...context, retryAfterMinutes })
    ).toEqual({ place: "notice", tone: "wait", text });
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "toString"]) {
      expect(renderStatusMessage(status, "email", context)).toBeNull();
      expect(renderStatusMessage(status, "code", context)).toBeNull();
    }
  });
});

// IF-SIGNIN-4: sent here from a signed-in page, sign-in says the code brings them back.
describe("backNotice", () => {
  it.each([
    ["/app/requests/abc"],
    ["/commish/requests/abc"],
  ])("says a sign-in from %s goes back to the request", (redirectPath) => {
    expect(backNotice(redirectPath)).toEqual({
      place: "notice",
      tone: "info",
      text: "Sign in to continue. You'll go straight back to your request.",
    });
  });

  it.each([
    ["/app?starter=6606"],
    ["/app/requests/new?injured=1&replacement=2"],
    ["/commish/settings"],
  ])("says a sign-in from %s goes back to where they were", (redirectPath) => {
    expect(backNotice(redirectPath)?.text).toBe(
      "Sign in to continue. You'll go straight back to where you were."
    );
  });

  it("says nothing for the starting page", () => {
    expect(backNotice("/app")).toBeNull();
  });
});
