import { describe, expect, it } from "vitest";
import { renderMarkup } from "../test-support";
import { PRACTICE_BAR_TEXT, REHEARSAL_BAR_TEXT } from "./labels";
import { RehearsalBar } from "./rehearsal-bar";

// The bar's text as a reader sees it: React escapes the apostrophe.
function barText(bar: "rehearsal" | "practice" | null): string {
  return renderMarkup(<RehearsalBar bar={bar} />).replaceAll("&#x27;", "'");
}

describe("RehearsalBar", () => {
  it("says nothing is sent to ESPN in a rehearsal", () => {
    expect(barText("rehearsal")).toContain(REHEARSAL_BAR_TEXT);
  });

  it("says swaps go to a practice copy of ESPN in practice", () => {
    const markup = barText("practice");

    expect(markup).toContain("Practice: swaps go to a practice copy of ESPN, never the real one.");
    expect(markup).not.toContain(REHEARSAL_BAR_TEXT);
    expect(PRACTICE_BAR_TEXT).not.toBe(REHEARSAL_BAR_TEXT);
  });

  it("shows nothing while the worker sends to the real league", () => {
    expect(barText(null)).toBe("");
  });
});
