import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { databaseCheck } = vi.hoisted(() => ({
  databaseCheck: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../../lib/server/db", () => ({
  getWebDatabaseConnection: () => ({ check: databaseCheck }),
}));

function captureConsoleError() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});

  return () => spy.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  databaseCheck.mockReset();
  globalThis.__injurysubWebLogger = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers 200 when the database answers", async () => {
    databaseCheck.mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, dependencies: { database: "ok" } });
  });

  // The health check is public, so it says only that the database failed, never how.
  it("answers 503 without the database's error, and logs the failure", async () => {
    databaseCheck.mockRejectedValue(
      new Error("connect ECONNREFUSED db.internal.example:5432 (invented-password)")
    );
    const errorLines = captureConsoleError();

    const response = await GET();

    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toMatchObject({ ok: false, dependencies: { database: "error" } });
    expect(JSON.parse(body)).not.toHaveProperty("error");
    expect(body).not.toContain("db.internal.example");
    expect(body).not.toContain("invented-password");
    expect(errorLines().map((line) => JSON.parse(line).event)).toEqual([
      "web.health.database_failed",
    ]);
  });
});
