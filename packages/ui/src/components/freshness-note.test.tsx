import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { FreshnessNote } from "./freshness-note";

describe("FreshnessNote", () => {
  it("says when ESPN was read, offers Refresh, and says nothing more", () => {
    const html = renderMarkup(<FreshnessNote readAt="Wed 6:39 PM PT" refreshHref="/app" />);

    expect(elementsByTag(html, "p")).toHaveLength(1);
    expect(elementsWithClass(html, "btn-ghost")).toEqual([
      { tag: "a", attributes: { class: "btn-ghost", href: "/app" } },
    ]);
    expect(html).toContain('d="M20 12a8 8 0 1 1-2.34-5.66"');
    expect(textOf(html)).toBe("Updated Wed 6:39 PM PTRefresh");
  });
});
