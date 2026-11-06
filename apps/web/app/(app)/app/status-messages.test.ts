import { describe, expect, it } from "vitest";
import { renderRequestStatus } from "./status-messages";

describe("renderRequestStatus", () => {
  it("gives the PRD's words when the starter is no longer OUT", () => {
    expect(renderRequestStatus("not_out")).toEqual({
      body: "Player is no longer listed as OUT.",
      tone: "danger",
    });
  });

  it("says nothing was recorded when ESPN couldn't be checked", () => {
    expect(renderRequestStatus("espn_unreachable")?.body).toBe(
      "The app couldn't check ESPN, so nothing was recorded. Try again, or contact the commissioner."
    );
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "toString"]) {
      expect(renderRequestStatus(status)).toBeNull();
    }
  });
});
