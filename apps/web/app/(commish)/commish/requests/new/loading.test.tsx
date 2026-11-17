import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../../../../../components/test-support";
import FilingLoading from "./loading";

// Without its own, the queue's placeholder (its parent's) would show while the form loads.
describe("the filing form's loading state", () => {
  it("says the form's title and draws rows the size of the pick rows", () => {
    const html = renderMarkup(<FilingLoading />);

    expect(textOf(html)).toContain("File for a manager");
    // The queue's heading, not the frame's Queue tab.
    expect(html).not.toMatch(/<h1[^>]*>Queue<\/h1>/);
    expect(elementsWithClass(html, "rows")[0]?.attributes["aria-hidden"]).toBe("true");
  });
});
