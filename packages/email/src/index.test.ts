import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSignInCodeEmail, createEmailClient, EmailError } from "./index";

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
