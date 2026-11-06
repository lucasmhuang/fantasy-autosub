import { describe, expect, it } from "vitest";
import { renderCommissionerStatus } from "./status-messages";

describe("renderCommissionerStatus", () => {
  it("confirms a manual completion", () => {
    expect(renderCommissionerStatus("completed_manually")).toEqual({
      body: "Recorded as completed by hand.",
      tone: "success",
    });
  });

  it("says when another tab acted first", () => {
    expect(renderCommissionerStatus("changed")?.tone).toBe("danger");
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "hasOwnProperty"]) {
      expect(renderCommissionerStatus(status)).toBeNull();
    }
  });
});
