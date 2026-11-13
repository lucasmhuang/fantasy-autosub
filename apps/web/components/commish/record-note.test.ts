import { describe, expect, it } from "vitest";
import { recordNote } from "./record-note";

describe("recordNote", () => {
  it("gives a commissioner's typed reason after the event", () => {
    expect(recordNote({ reason: "He played that night." })).toBe(": He played that night.");
  });

  // Q12, OQ2: the record says when the commissioner approved their own team's request.
  it("says when an approval was the commissioner's own team's", () => {
    expect(recordNote({ computedTenths: -30, selfApproval: true })).toBe(
      " (their own team's request)"
    );
    expect(recordNote({ computedTenths: -30, selfApproval: false })).toBe("");
  });

  it("adds nothing for an event that carries neither", () => {
    for (const payload of [null, undefined, "text", {}, { reason: 5 }]) {
      expect(recordNote(payload)).toBe("");
    }
  });
});
