import { SIGN_IN_CODE_MAX_ATTEMPTS } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import { backNotice, renderStatusMessage } from "./status-messages";

const context = { retryAfterMinutes: null, triesLeft: null, codeWorksUntil: null };
const UNTIL = "Wed 6:51 PM PT";

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
    ["send_failed", "fail", "The code didn't send."],
    ["unavailable", "fail", "Something went wrong. Try again in a moment."],
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
    ["code_expired", "This code expired or was used. Only the newest code works."],
  ])("puts %s under the code field", (status, text) => {
    expect(renderStatusMessage(status, "code", context)).toEqual({ place: "field", text });
  });

  it.each([
    [
      "too_many_tries",
      "fail",
      `${SIGN_IN_CODE_MAX_ATTEMPTS} wrong tries; this code no longer works.`,
    ],
    ["unavailable", "fail", "Something went wrong. Try again in a moment."],
  ] as const)("shows %s on the code step as a notice", (status, tone, text) => {
    expect(renderStatusMessage(status, "code", context)).toEqual({ place: "notice", tone, text });
  });

  // FM-SIGNIN-10: the code already sent works until its expiry, or has expired.
  it("says until when the last code works after a failed new code, or that it expired", () => {
    expect(
      renderStatusMessage("send_failed", "code", { ...context, codeWorksUntil: UNTIL })
    ).toEqual({
      place: "notice",
      tone: "fail",
      text: `The new code didn't send. Your last one works until ${UNTIL}.`,
    });
    expect(renderStatusMessage("send_failed", "code", context)?.text).toBe(
      "The new code didn't send, and your last one expired. Try again in a moment."
    );
  });

  // FM-SIGNIN-9: how long to wait, and until when the newest code works, or that it expired.
  it.each([
    [1, "Code limit reached. Ask again in 1 minute; your newest code works until Wed 6:51 PM PT."],
    [
      12,
      "Code limit reached. Ask again in 12 minutes; your newest code works until Wed 6:51 PM PT.",
    ],
    [
      60,
      "Code limit reached. Ask again in about 1 hour; your newest code works until Wed 6:51 PM PT.",
    ],
    [
      61,
      "Code limit reached. Ask again in about 2 hours; your newest code works until Wed 6:51 PM PT.",
    ],
    [null, "Code limit reached. Ask again later; your newest code works until Wed 6:51 PM PT."],
  ])("says how long to wait %s minutes after too many codes", (retryAfterMinutes, text) => {
    expect(
      renderStatusMessage("too_many_codes", "code", {
        ...context,
        retryAfterMinutes,
        codeWorksUntil: UNTIL,
      })
    ).toEqual({ place: "notice", tone: "wait", text });
  });

  it("says the newest code has expired when the limit is reached after it", () => {
    expect(
      renderStatusMessage("too_many_codes", "code", { ...context, retryAfterMinutes: 12 })?.text
    ).toBe("Code limit reached, and your newest code has expired. Ask again in 12 minutes.");
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
      text: "Sign in to go back to your request.",
    });
  });

  it.each([
    ["/app?starter=6606"],
    ["/app/requests/new?injured=1&replacement=2"],
    ["/commish/settings"],
  ])("says a sign-in from %s goes back to where they were", (redirectPath) => {
    expect(backNotice(redirectPath)?.text).toBe("Sign in to go back where you were.");
  });

  it("says nothing for the starting page", () => {
    expect(backNotice("/app")).toBeNull();
  });
});
