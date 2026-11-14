import { describe, expect, it } from "vitest";
import { commissionerReasonFor } from "./review-reasons";

describe("commissionerReasonFor", () => {
  it("says a request waits for approval", () => {
    expect(commissionerReasonFor("awaiting_approval", null)).toBe("it waits for your approval");
  });

  it("says why a request is in review", () => {
    expect(commissionerReasonFor("needs_review", "expired")).toMatch(/waited past its window/);
    expect(commissionerReasonFor("needs_review", "automation_off")).toMatch(/automation is off/);
  });

  // Owner, 2026-11-14: these show for causes besides ESPN refusing the write (sending off, the
  // week moved on, a long note, an earlier credit, a 200 that didn't apply), so they name none.
  it("never says ESPN refused a write that may simply not have been sent or shown", () => {
    for (const reason of ["lineup_failed", "adjustment_failed"] as const) {
      expect(commissionerReasonFor("needs_review", reason)).not.toMatch(/refused/);
    }
    expect(commissionerReasonFor("needs_review", "adjustment_failed")).toBe(
      "the adjustment wasn't written; enter it by hand"
    );
  });

  it("gives nothing for a request that doesn't need the commissioner", () => {
    expect(commissionerReasonFor("queued", null)).toBeNull();
    expect(commissionerReasonFor("needs_review", null)).toBeNull();
  });
});
