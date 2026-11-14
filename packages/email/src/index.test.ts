import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCommissionerNotification,
  buildCommissionerOutboxEmail,
  buildCredentialsRefusedOutboxEmail,
  buildMisuseAlertOutboxEmail,
  buildSignInCodeEmail,
  buildWatchPausedOutboxEmail,
  createEmailClient,
  EmailError,
  isRetryableEmailFailure,
} from "./index";

// Resend is faked at its HTTP boundary, so the real SDK runs.
const providerFetch =
  vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function respondFromProvider(status: number, body: unknown) {
  providerFetch.mockImplementation(async () =>
    Response.json(body, { status, headers: { "content-type": "application/json" } })
  );
}

function resendClient(options: { sendTimeoutMs?: number } = {}) {
  return createEmailClient({
    mode: "resend",
    fromAddress: "signin@mail.injurysub.example",
    resendApiKey: "re_invented_key",
    ...options,
  });
}

const message = { to: "manager@example.test", subject: "Sign in to InjurySub", text: "000042" };

async function failureOf(sending: Promise<unknown>): Promise<EmailError> {
  try {
    await sending;
  } catch (error) {
    if (error instanceof EmailError) return error;
    throw error;
  }
  throw new Error("expected the send to fail");
}

function thrownBy(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("expected it to throw");
}

beforeEach(() => {
  providerFetch.mockReset();
  vi.stubGlobal("fetch", providerFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSignInCodeEmail", () => {
  it("carries the code and its lifetime, and no link", () => {
    const email = buildSignInCodeEmail({
      to: "manager@example.test",
      code: "000042",
      ttlMinutes: 10,
    });

    expect(email.to).toBe("manager@example.test");
    expect(email.subject).toBe("Sign in to InjurySub");
    expect(email.text).toContain("Your InjurySub sign-in code is 000042.");
    expect(email.text).toContain("10 minutes");
    expect(email.text).toContain("InjurySub never sends sign-in links.");
    expect(email.text).not.toContain("http");
  });
});

describe("createEmailClient in resend mode", () => {
  // The request Resend's API receives. The sender carries a display name (Dec-D32b), so an inbox
  // shows "InjurySub" rather than the address's local part.
  it("sends the message from InjurySub at the configured sender, with the API key", async () => {
    respondFromProvider(200, { id: "msg_1" });

    const result = await resendClient().send(message);

    expect(result).toEqual({ messageId: "msg_1", mode: "resend" });
    const [input, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer re_invented_key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: "InjurySub <signin@mail.injurysub.example>",
      ...message,
    });
  });

  it("refuses with send_rejected, keeping only the provider's error name and status", async () => {
    respondFromProvider(403, {
      name: "validation_error",
      message: "The marker-7f3a domain is not verified.",
      statusCode: 403,
    });

    const failure = await failureOf(resendClient().send(message));

    expect(failure.code).toBe("send_rejected");
    expect(failure.cause).toBeInstanceOf(Error);
    const causeMessage = failure.cause instanceof Error ? failure.cause.message : "";
    expect(causeMessage).toBe("validation_error (HTTP 403)");
    expect(`${failure.message} ${causeMessage}`).not.toContain("marker-7f3a");
  });

  it("refuses with send_timeout when the provider doesn't answer in time", async () => {
    providerFetch.mockImplementation(() => new Promise<Response>(() => {}));
    const started = performance.now();

    const failure = await failureOf(resendClient({ sendTimeoutMs: 50 }).send(message));

    expect(failure.code).toBe("send_timeout");
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("refuses to start with not_configured when there's no API key", () => {
    const failure = thrownBy(() =>
      createEmailClient({ mode: "resend", fromAddress: "signin@mail.injurysub.example" })
    );

    expect(failure).toBeInstanceOf(EmailError);
    expect(failure).toMatchObject({ code: "not_configured" });
  });
});

describe("createEmailClient in console mode", () => {
  it("prints the message from the same named sender resend mode uses", async () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await createEmailClient({
        mode: "console",
        fromAddress: "signin@mail.injurysub.example",
      }).send(message);
    } finally {
      log.mockRestore();
    }

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ from: "InjurySub <signin@mail.injurysub.example>", ...message }),
    ]);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});

describe("buildCommissionerNotification", () => {
  const notification = buildCommissionerNotification({
    to: "commissioner@example.test",
    teamName: "Invented Team",
    teamId: 5,
    injuredName: "Invented Starter",
    replacementName: "Invented Bench",
    reason: "automation is off, so it waits for you to settle it by hand",
    adjustment: "+5.1",
  });

  it("names the team in the subject", () => {
    expect(notification.subject).toContain("Invented Team");
  });

  it("names the team, both players, why it needs the commissioner and the amount", () => {
    for (const part of [
      "Invented Team",
      "Invented Starter",
      "Invented Bench",
      "settle it by hand",
      "+5.1",
    ]) {
      expect(notification.text).toContain(part);
    }
  });

  it("carries no link and no email address", () => {
    expect(notification.text).not.toMatch(/http/i);
    expect(notification.text).not.toContain("@");
    expect(notification.subject).not.toContain("@");
  });

  it("names the team by its number when no ESPN name is at hand", () => {
    const unnamed = buildCommissionerNotification({
      to: "commissioner@example.test",
      teamName: null,
      teamId: 5,
      injuredName: "Invented Starter",
      replacementName: "Invented Bench",
      reason: "it waited past its window without being carried out",
      adjustment: null,
    });

    expect(unnamed.subject).toBe("InjurySub: Team 5 needs you");
    expect(unnamed.text).toContain("A substitution request from team 5 needs you");
  });

  it("says when no adjustment is owed", () => {
    const none = buildCommissionerNotification({
      to: "commissioner@example.test",
      teamName: "Invented Team",
      teamId: 5,
      injuredName: "Invented Starter",
      replacementName: "Invented Bench",
      reason: "it waits for your approval",
      adjustment: null,
    });

    expect(none.text).toContain("No adjustment is owed");
  });
});

describe("buildCommissionerOutboxEmail", () => {
  const input = {
    requestId: "1b2c3d4e-0000-4000-8000-000000000000",
    version: 3,
    to: "commissioner@example.test",
    teamName: null,
    teamId: 5,
    injuredName: "Invented Starter",
    replacementName: "Invented Bench",
    reason: "it waits for your approval",
    adjustmentTenths: 51,
  };

  it("keys the email by the request and its version after the change, so each change sends once", () => {
    expect(buildCommissionerOutboxEmail(input)).toMatchObject({
      dedupeKey: "1b2c3d4e-0000-4000-8000-000000000000:3",
      toAddress: "commissioner@example.test",
      subject: "InjurySub: Team 5 needs you",
    });
  });

  it("gives the amount in points from tenths, and none for zero", () => {
    expect(buildCommissionerOutboxEmail(input).body).toContain("Adjustment: +5.1 points");
    expect(buildCommissionerOutboxEmail({ ...input, adjustmentTenths: 0 }).body).toContain(
      "No adjustment is owed"
    );
    expect(buildCommissionerOutboxEmail({ ...input, adjustmentTenths: null }).body).toContain(
      "No adjustment is owed"
    );
  });
});

describe("sending with an idempotency key", () => {
  it("sends the key to Resend as its Idempotency-Key header", async () => {
    respondFromProvider(200, { id: "email-1" });

    await resendClient().send(message, { idempotencyKey: "request-1:2" });

    const init = providerFetch.mock.lastCall?.[1];
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("request-1:2");
  });

  it("tells a send worth retrying (no answer, 429, 5xx) from a refusal", async () => {
    providerFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const unreachable = await failureOf(resendClient().send(message, { idempotencyKey: "k" }));
    respondFromProvider(503, { name: "internal_server_error", message: "Down.", statusCode: 503 });
    const down = await failureOf(resendClient().send(message, { idempotencyKey: "k" }));
    respondFromProvider(429, { name: "rate_limit_exceeded", message: "Slow.", statusCode: 429 });
    const limited = await failureOf(resendClient().send(message, { idempotencyKey: "k" }));
    respondFromProvider(422, { name: "validation_error", message: "Bad.", statusCode: 422 });
    const refused = await failureOf(resendClient().send(message, { idempotencyKey: "k" }));

    expect(
      [unreachable, down, limited, refused].map((error) => [
        error.code,
        isRetryableEmailFailure(error),
      ])
    ).toEqual([
      ["send_unavailable", true],
      ["send_unavailable", true],
      ["send_unavailable", true],
      ["send_rejected", false],
    ]);
  });

  it("counts a send timeout as worth retrying", () => {
    expect(isRetryableEmailFailure(new EmailError("send_timeout", "No answer."))).toBe(true);
    expect(isRetryableEmailFailure(new EmailError("not_configured", "No key."))).toBe(false);
  });
});

describe("buildCredentialsRefusedOutboxEmail", () => {
  it("tells the commissioner the cookie needs renewing, once per refusal", () => {
    const email = buildCredentialsRefusedOutboxEmail({
      to: "commissioner@example.test",
      since: new Date("2026-11-13T18:00:00.000Z"),
    });

    expect(email).toMatchObject({
      dedupeKey: "espn-access:credentials_rejected:2026-11-13T18:00:00.000Z",
      toAddress: "commissioner@example.test",
      subject: "InjurySub: ESPN refused the cookie",
    });
    expect(email.body).toContain("renew the ESPN cookie");
    expect(email.body).not.toMatch(/https?:/);
  });

  // Dec-D32c: one email for a refused cookie, which also says the misuse watch is paused.
  it("says the misuse watch is paused until ESPN accepts a new cookie", () => {
    const email = buildCredentialsRefusedOutboxEmail({
      to: "commissioner@example.test",
      since: new Date("2026-11-13T18:00:00.000Z"),
    });

    expect(email.body).toContain("Misuse watch: paused until ESPN accepts a new cookie.");
  });
});

describe("buildMisuseAlertOutboxEmail", () => {
  const input = {
    to: "commissioner@example.test",
    alertId: "0b6c1d52-0000-4000-8000-000000000009",
    teamName: "Invented Hoopers",
    espnAt: new Date("2026-11-15T21:00:00.000Z"),
    what: "A league-manager lineup edit InjurySub didn't make: 2 moves.",
    undo: ["Move Player A from BE back to F/C.", "Move Player B from F/C back to BE."],
  };

  it("names the team as ESPN does, ESPN's time in PT, what undoing it takes, once per alert", () => {
    const email = buildMisuseAlertOutboxEmail(input);

    expect(email).toMatchObject({
      dedupeKey: `misuse-alert:${input.alertId}`,
      toAddress: input.to,
      subject: "InjurySub: check a league-manager action on Invented Hoopers",
    });
    expect(email.body).toContain(input.what);
    expect(email.body).toContain("ESPN's time: Sun, 11/15, 1:00 PM PT");
    expect(email.body).toContain(
      "Move Player A from BE back to F/C.\nMove Player B from F/C back to BE."
    );
    expect(email.body).toContain("Deleting the cookie from Railway doesn't revoke it");
    expect(email.body).not.toMatch(/https?:/);
  });

  it("names the league when the action isn't a team's", () => {
    const email = buildMisuseAlertOutboxEmail({ ...input, teamName: null, espnAt: null });

    expect(email.subject).toBe("InjurySub: check a league-manager action on the league");
    expect(email.body).not.toContain("ESPN's time");
  });
});

describe("buildWatchPausedOutboxEmail", () => {
  it("says the misuse watch is paused since when, once per pause", () => {
    const since = new Date("2026-11-15T21:00:00.000Z");

    const email = buildWatchPausedOutboxEmail({ to: "commissioner@example.test", since });

    expect(email).toMatchObject({
      dedupeKey: "misuse-watch:paused:2026-11-15T21:00:00.000Z",
      subject: "InjurySub: the misuse watch is paused",
    });
    expect(email.body).toContain("since Sun, 11/15, 1:00 PM PT");
    expect(email.body).not.toMatch(/https?:/);
  });
});
