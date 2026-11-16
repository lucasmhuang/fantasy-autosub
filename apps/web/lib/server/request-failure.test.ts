import { afterEach, describe, expect, it, vi } from "vitest";
import { logRequestFailure } from "./request-failure";

afterEach(() => {
  vi.restoreAllMocks();
});

// A drizzle error's message carries the query and its parameters (an address, a session id).
function drizzleShaped(): Error {
  const cause = Object.assign(new Error("terminating connection due to administrator command"), {
    code: "57P01",
  });
  return new Error(
    'Failed query: select * from "user_accounts" where email = $1\nparams: dana@example.com',
    {
      cause,
    }
  );
}

// AC1-10: a failure no page handled is logged by route and a fixed label, never its message.
describe("logRequestFailure", () => {
  it("logs the route and the failure's code, not its message or parameters", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    logRequestFailure(
      drizzleShaped(),
      { method: "GET", path: "/login?email=dana%40example.com" },
      { routePath: "/app/requests/[id]", routeType: "render" }
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "web.request.failed",
      route: "/app/requests/[id]",
      routeType: "render",
      method: "GET",
      reason: "57P01",
    });
    expect(lines[0]).not.toContain("dana");
    expect(lines[0]).not.toContain("select");
  });
});
