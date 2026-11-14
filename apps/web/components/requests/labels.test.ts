import { describe, expect, it } from "vitest";
import { DELAYED_TEXT, REVIEW_REASON_TEXT } from "./labels";

// Owner, 2026-11-14: texts shown for more than one cause name none of them.
describe("the manager's texts", () => {
  it("never says ESPN refused a write that may simply not have been sent or shown", () => {
    expect(REVIEW_REASON_TEXT.lineup_failed).not.toMatch(/refused/);
    expect(REVIEW_REASON_TEXT.adjustment_failed).not.toMatch(/refused/);
  });

  it("says a delayed request waits, which fits one in line and one in progress alike", () => {
    expect(DELAYED_TEXT).not.toMatch(/in line/);
    expect(DELAYED_TEXT).toMatch(/waits/);
  });
});
