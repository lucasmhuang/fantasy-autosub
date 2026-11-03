import { describe, expect, it } from "vitest";
import { renderStatusMessage } from "./status-messages";

const context = {
  email: "manager@example.test",
  sender: "signin@mail.injurysub.example",
  retryAfterMinutes: null,
  triesLeft: null,
};

// The statuses are the ones the request-code, verify-code and logout routes write into /login.
describe("renderStatusMessage", () => {
  it("says where the code went and who sent it", () => {
    expect(renderStatusMessage("code_sent", context)).toEqual({
      body: "We emailed a 6-digit code to manager@example.test from signin@mail.injurysub.example.",
      tone: "success",
    });
  });

  it("counts the tries left after a wrong code", () => {
    const message = "That code isn't right. Use the code from the newest email.";

    expect(renderStatusMessage("wrong_code", { ...context, triesLeft: 2 })).toEqual({
      body: `${message} 2 tries left.`,
      tone: "danger",
    });
    expect(renderStatusMessage("wrong_code", { ...context, triesLeft: 1 })?.body).toBe(
      `${message} 1 try left.`
    );
    expect(renderStatusMessage("wrong_code", context)?.body).toBe(message);
  });

  it.each([
    ["too_many_tries", "That code had too many wrong tries. Send a new code."],
    ["code_expired", "That code has expired or was already used. Send a new code."],
    ["invalid_code", "Enter the 6-digit code from the email."],
    ["unknown_email", "I don't recognize that email address. Ask your commissioner to add you."],
    ["invalid_email", "Enter a valid email address."],
    ["send_failed", "The sign-in email could not be sent. Try again in a moment."],
  ])("explains %s", (status, body) => {
    expect(renderStatusMessage(status, context)).toEqual({ body, tone: "danger" });
  });

  it.each([
    [1, "Too many codes requested. Try again in 1 minute."],
    [7, "Too many codes requested. Try again in 7 minutes."],
    [59, "Too many codes requested. Try again in 59 minutes."],
    [60, "Too many codes requested. Try again in about 1 hour."],
    [61, "Too many codes requested. Try again in about 2 hours."],
    [840, "Too many codes requested. Try again in about 14 hours."],
    [null, "Too many codes requested. Try again later."],
  ])("says how long to wait %s minutes after too many codes", (retryAfterMinutes, body) => {
    expect(renderStatusMessage("too_many_codes", { ...context, retryAfterMinutes })).toEqual({
      body,
      tone: "danger",
    });
  });

  it("confirms a sign-out", () => {
    expect(renderStatusMessage("signed_out", context)).toEqual({
      body: "You have been signed out.",
      tone: "muted",
    });
  });

  it.each([null, "email_sent", "anything-else"])("shows nothing for %j", (status) => {
    expect(renderStatusMessage(status, context)).toBeNull();
  });

  it("never mentions a link", () => {
    const statuses = [
      "code_sent",
      "wrong_code",
      "too_many_tries",
      "code_expired",
      "invalid_code",
      "too_many_codes",
      "unknown_email",
      "invalid_email",
      "send_failed",
      "signed_out",
    ];
    for (const status of statuses) {
      expect(renderStatusMessage(status, context)?.body).not.toMatch(/link/i);
    }
  });
});
