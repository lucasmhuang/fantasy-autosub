import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { RehearsalBar } from "./rehearsal-bar";

describe("RehearsalBar", () => {
  it("marks a run that sends nothing to ESPN", () => {
    const html = renderMarkup(<RehearsalBar mode="rehearsal" />);

    expect(elementsWithClass(html, "rehearsal")[0]?.attributes.role).toBe("note");
    expect(textOf(html)).toBe("RehearsalNothing here is sent to ESPN.");
  });

  it("marks staging, whose swaps go to a practice copy of ESPN", () => {
    const html = renderMarkup(<RehearsalBar mode="practice" />);

    expect(elementsWithClass(html, "rehearsal")[0]?.attributes.role).toBe("note");
    expect(textOf(html)).toBe("PracticeSwaps go to a practice copy of ESPN.");
  });
});
