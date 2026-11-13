import { EspnError } from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebEspn, isWorkerRehearsing } from "./espn";

afterEach(() => {
  globalThis.__injurysubWebEspn = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getWebEspn", () => {
  it("reads ESPN through the worker named by the settings, with their token", async () => {
    vi.stubEnv("WORKER_INTERNAL_URL", "http://worker.internal.example:3901");
    vi.stubEnv("WORKER_INTERNAL_TOKEN", "w".repeat(40));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      asked.push(`${String(input)} ${new Headers(init?.headers).get("authorization")}`);
      return Response.json({ ok: true, result: { teamId: 3 } });
    });

    expect(await getWebEspn().getTeamWeek(3)).toEqual({ teamId: 3 });
    expect(asked).toEqual([
      `http://worker.internal.example:3901/internal/espn/team-week Bearer ${"w".repeat(40)}`,
    ]);
  });

  it("gives the client a test put in its place", () => {
    const replacement = {
      getTeamWeek: async () => Promise.reject(new Error("not asked")),
      checkLeagueRules: async () => Promise.reject(new Error("not asked")),
      getWorkerStatus: async () => Promise.reject(new Error("not asked")),
    };
    globalThis.__injurysubWebEspn = replacement;

    expect(getWebEspn()).toBe(replacement);
  });
});

function workerReporting(status: () => Promise<{ sendMode: "never" | "live" }>): void {
  globalThis.__injurysubWebEspn = {
    getTeamWeek: async () => Promise.reject(new Error("not asked")),
    checkLeagueRules: async () => Promise.reject(new Error("not asked")),
    getWorkerStatus: status,
  };
}

describe("isWorkerRehearsing", () => {
  it("says the worker is rehearsing while its send mode is never, and not while it is live", async () => {
    workerReporting(async () => ({ sendMode: "never" }));
    expect(await isWorkerRehearsing()).toBe(true);

    workerReporting(async () => ({ sendMode: "live" }));
    expect(await isWorkerRehearsing()).toBe(false);
  });

  // An older worker during a deploy has no status to give: no bar is shown on a guess.
  it("says nothing of a rehearsal while the worker's status can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    workerReporting(async () => Promise.reject(new EspnError("worker_unreachable", "invented")));

    expect(await isWorkerRehearsing()).toBe(false);
    vi.restoreAllMocks();
  });
});
