import { describe, expect } from "vitest";
import { webDbTest } from "./test-support";

// The two tests run in order: the first leaves a client in the web's ESPN singleton, and the
// second must not see it.
describe("webDbTest", () => {
  webDbTest("lets a test put its own ESPN client in the web's place", () => {
    globalThis.__injurysubWebEspn = {
      getTeamWeek: async () => Promise.reject(new Error("not asked")),
      checkLeagueRules: async () => Promise.reject(new Error("not asked")),
      getWorkerStatus: async () => Promise.reject(new Error("not asked")),
    };
    expect(globalThis.__injurysubWebEspn).toBeDefined();
  });

  webDbTest("starts each test without the previous test's ESPN client", () => {
    expect(globalThis.__injurysubWebEspn).toBeUndefined();
  });
});
