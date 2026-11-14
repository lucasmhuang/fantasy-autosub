import { describe, expect, it } from "vitest";
import { executorTasks } from "./executor";

describe("executorTasks", () => {
  const run = async () => {};
  const beat = { name: "heartbeat", run: async () => {} };

  // The beat follows the pass in one scheduler, so a pass that hangs stops the beats (O8).
  it("schedules the executor wherever ESPN can be read, the beat after it", () => {
    for (const mode of ["live", "stub", "scripted"] as const) {
      expect(executorTasks({ mode, run, beat })).toEqual([{ name: "executor", run }, beat]);
    }
  });

  it("beats without the cookie too, where the executor isn't scheduled", () => {
    expect(executorTasks({ mode: "none", run, beat })).toEqual([beat]);
  });
});
