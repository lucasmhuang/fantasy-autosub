import { describe, expect, it } from "vitest";
import { createRosterExecutionPlan } from "./index";

describe("createRosterExecutionPlan", () => {
  // The planner isn't built yet. Until it is, it plans no ESPN write.
  it("plans no roster steps yet", () => {
    expect(createRosterExecutionPlan()).toEqual([]);
  });
});
