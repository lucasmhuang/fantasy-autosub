import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { loginLinks } = vi.hoisted(() => ({
  loginLinks: [] as { token: string; userId: string; status: string }[],
}));

vi.mock("@injurysub/db", () => ({
  findActiveUserAccountByEmail: async (_db: unknown, email: string) =>
    email === "manager.test@example.com"
      ? { userId: "user-1", email, role: "manager", isActive: true }
      : null,
  createLoginLinkToken: async (
    _db: unknown,
    row: { token: string; userId: string; status: string }
  ) => {
    loginLinks.push({ token: row.token, userId: row.userId, status: row.status });
  },
  revokeLoginLinkToken: async (_db: unknown, token: string) => {
    for (const link of loginLinks) {
      if (link.token === token) {
        link.status = "revoked";
      }
    }
  },
}));

vi.mock("../../../lib/server/db", () => ({
  getWebDatabaseConnection: () => ({ db: {} }),
}));

// The email provider is faked at its HTTP boundary, so the real Resend SDK and email client run.
// (`resend` cannot be mocked by module name from apps/web: only packages/email depends on it.)
const providerFetch =
  vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function respondFromProvider(status: number, body: unknown) {
  providerFetch.mockImplementation(async () =>
    Response.json(body, { status, headers: { "content-type": "application/json" } })
  );
}

function captureConsoleError() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  return () => spy.mock.calls.map((call) => String(call[0]));
}

function requestSignInLink(email: string) {
  return POST(
    new Request("http://localhost:3000/auth/request-link", {
      method: "POST",
      body: new URLSearchParams({ email }),
    })
  );
}

beforeEach(() => {
  loginLinks.length = 0;
  providerFetch.mockReset();
  vi.stubGlobal("fetch", providerFetch);
  vi.stubEnv("EMAIL_DELIVERY_MODE", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_probe_secret");
  globalThis.__injurysubWebEmailClient = undefined;
  globalThis.__injurysubWebLogger = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function expectOneProviderCall() {
  expect(providerFetch).toHaveBeenCalledTimes(1);
  const [input, init] = providerFetch.mock.calls[0] ?? [];
  expect(String(input)).toMatch(/\/emails$/);
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer re_probe_secret");
}

describe("POST /auth/request-link", () => {
  it("logs a failed sign-in email with its cause and revokes the link", async () => {
    respondFromProvider(403, {
      name: "validation_error",
      message: "The domain is not verified.",
      statusCode: 403,
    });
    const errorLines = captureConsoleError();

    const response = await requestSignInLink("manager.test@example.com");

    expectOneProviderCall();
    const location = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("status")).toBe("send_failed");
    expect(location.searchParams.get("email")).toBe("manager.test@example.com");

    expect(loginLinks).toHaveLength(1);
    const [link] = loginLinks;
    expect(link?.status).toBe("revoked");

    const lines = errorLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      service: "web",
      event: "web.auth.magic_link_send_failed",
      userId: "user-1",
      error: {
        message: "The domain is not verified.",
        cause: { name: "validation_error", statusCode: 403 },
      },
    });
    expect(lines[0]).not.toContain(String(link?.token));
    expect(lines[0]).not.toContain("/auth/magic/");
    expect(lines[0]).not.toContain("re_probe_secret");
  });

  it("keeps the provider's error details out of the person's redirect", async () => {
    respondFromProvider(403, {
      name: "validation_error",
      message: "The domain is not verified.",
      statusCode: 403,
    });
    captureConsoleError();

    const response = await requestSignInLink("manager.test@example.com");

    const location = new URL(response.headers.get("location") ?? "");
    expect([...location.searchParams.keys()]).toEqual(["status", "email", "redirect"]);
    expect(location.href).not.toMatch(/verified|validation_error/);
  });

  it("sends the link and redirects back with the email, without logging an error", async () => {
    respondFromProvider(200, { id: "msg_1" });
    const errorLines = captureConsoleError();

    const response = await requestSignInLink("manager.test@example.com");

    expectOneProviderCall();
    const location = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(303);
    expect(location.searchParams.get("status")).toBe("email_sent");
    expect(location.searchParams.get("email")).toBe("manager.test@example.com");
    expect(loginLinks[0]?.status).toBe("active");
    expect(errorLines()).toHaveLength(0);
  });
});
