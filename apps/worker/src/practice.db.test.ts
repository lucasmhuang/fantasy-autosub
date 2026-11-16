import { loadServerEnv } from "@injurysub/config";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { createWorkerEspn } from "./espn-client";
import { runExecutorPass } from "./executor/executor";
import {
  attemptsOf,
  contextFor,
  detailOf,
  insertTatumRequest,
  setUp,
  TATUM_OWED,
  TEAM,
} from "./executor/test-support";
import { dbTest } from "./test-support";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a practice worker", () => {
  // The global fetch stays the test run's network guard throughout.
  dbTest(
    "runs a request through its lineup write, adjustment and readbacks to completed, on its fake alone",
    async ({ database }) => {
      const espn = await createWorkerEspn(loadServerEnv({ ESPN_MODE: "practice" }));
      if (espn.practice === null) throw new Error("practice mode built no fake ESPN");
      const setup = await setUp(database.connection, [TEAM], espn.practice);
      const requestId = await insertTatumRequest(setup);

      const result = await runExecutorPass({
        ...contextFor(setup),
        espn: espn.read,
        write: espn.write,
      });

      expect(result).toMatchObject({ kind: "completed", finalTenths: TATUM_OWED });
      const { request } = await detailOf(setup, requestId);
      expect(request).toMatchObject({
        status: "completed",
        isRehearsal: false,
        lineupState: "verified",
        adjustmentState: "verified",
      });
      const attempts = await attemptsOf(setup, requestId);
      expect(attempts.map(({ kind, outcome }) => ({ kind, outcome }))).toEqual([
        { kind: "lineup", outcome: "verified" },
        { kind: "adjustment", outcome: "verified" },
      ]);
      expect(espn.practice.posts.map((post) => post.kind)).toEqual(["lineup", "adjustment"]);
    }
  );
});
