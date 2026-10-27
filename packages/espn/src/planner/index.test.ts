import { describe, expect, it } from "vitest";
import { createRosterExecutionPlan } from "./index";

describe("createRosterExecutionPlan", () => {
  // The planner comes with a later roadmap step. Until then it plans no ESPN write (RS4).
  it("plans no roster steps yet", () => {
    expect(createRosterExecutionPlan()).toEqual([]);
  });
});
