import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { SectionHeader } from "./section-header";

describe("SectionHeader", () => {
  it("labels a list with a real heading, and a note on reading its numbers", () => {
    const html = renderMarkup(<SectionHeader aside="Week · avg">Your requests</SectionHeader>);

    expect(elementsWithClass(html, "section-head")).toHaveLength(1);
    expect(elementsByTag(html, "h2")[0]?.attributes.class).toBe("t-label");
    expect(elementsWithClass(html, "aside")).toHaveLength(1);
    expect(textOf(html)).toBe("Your requestsWeek · avg");
  });

  it("keeps uppercase only where asked, and leaves the note out when there is none", () => {
    const html = renderMarkup(<SectionHeader caps>Starters</SectionHeader>);

    expect(elementsByTag(html, "h2")[0]?.attributes.class).toBe("t-eyebrow");
    expect(elementsWithClass(html, "aside")).toEqual([]);
  });

  it("takes a route's status colour", () => {
    const ready = renderMarkup(<SectionHeader tone="ok">Ready now · 3</SectionHeader>);
    const waiting = renderMarkup(<SectionHeader tone="wait">Needs you · 3</SectionHeader>);

    expect(elementsWithClass(ready, "t-label", "text-ok")).toHaveLength(1);
    expect(elementsWithClass(waiting, "t-label", "text-wait")).toHaveLength(1);
  });
});
