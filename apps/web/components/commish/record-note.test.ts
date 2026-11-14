import { describe, expect, it } from "vitest";
import { recordNote } from "./record-note";

describe("recordNote", () => {
  it("gives a commissioner's typed reason after the event", () => {
    expect(
      recordNote({ eventType: "rejected", payload: { reason: "He played that night." } })
    ).toBe(": He played that night.");
  });

  // Q12, OQ2: the record says when the commissioner approved their own team's request.
  it("says when an approval was the commissioner's own team's", () => {
    expect(
      recordNote({ eventType: "approved", payload: { computedTenths: -30, selfApproval: true } })
    ).toBe(" (their own team's request)");
    expect(
      recordNote({ eventType: "approved", payload: { computedTenths: -30, selfApproval: false } })
    ).toBe("");
  });

  // Owner, 2026-11-14: the record names why a request went to review in words, not its code.
  it("says why a request went to review in the commissioner's words", () => {
    const held = { eventType: "sent_to_review", payload: { reason: "adjustment_held_rules" } };

    expect(recordNote(held)).toBe(
      ": the league's rules differ from InjurySub's, so the adjustment is held"
    );
  });

  it("adds nothing for an event that carries neither", () => {
    for (const payload of [null, undefined, "text", {}, { reason: 5 }]) {
      expect(recordNote({ eventType: "approved", payload })).toBe("");
    }
  });
});
