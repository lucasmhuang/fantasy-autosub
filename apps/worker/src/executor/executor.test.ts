import { describe, expect, it } from "vitest";
import { executorTasks } from "./executor";

describe("executorTasks", () => {
  it("schedules the executor wherever ESPN can be read, and not without the cookie", () => {
    const run = async () => {};

    for (const mode of ["live", "stub", "scripted"] as const) {
      expect(executorTasks({ mode, run })).toEqual([{ name: "executor", run }]);
    }
    expect(executorTasks({ mode: "none", run })).toEqual([]);
  });
});
