import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCommissionerNotification,
  buildSignInCodeEmail,
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
  // The request Resend's API receives.
  it("sends the message from the configured sender, with the API key", async () => {
    respondFromProvider(200, { id: "msg_1" });

    const result = await resendClient().send(message);

    expect(result).toEqual({ messageId: "msg_1", mode: "resend" });
    const [input, init] = providerFetch.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer re_invented_key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: "signin@mail.injurysub.example",
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
