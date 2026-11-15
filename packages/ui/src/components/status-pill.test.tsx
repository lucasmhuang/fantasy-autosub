import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { type PillKind, StatusPill } from "./status-pill";

// Each kind's class and the first path of its glyph, from the design system's StatusPill.
const KINDS: [PillKind, string, string | null][] = [
  ["waiting", "pill-wait", 'd="M12 7.5V12l3 2"'],
  ["in-line", "pill-queued", 'd="M6 12h.01"'],
  ["in-progress", "pill-busy", 'd="M12 4.5a7.5 7.5 0 0 1 7.5 7.5"'],
  ["done", "pill-ok", 'd="M5 12.5l4.5 4.5L19 7.5"'],
  ["stopped", "pill-neutral", 'd="M6.5 6.5l11 11"'],
  ["undone", "pill-neutral", 'd="M9 14l-5-5 5-5"'],
  ["out", "pill-out", null],
  ["label", "pill-outline", null],
];

describe("StatusPill", () => {
  it.each(KINDS)("shows %s as %s with its glyph", (kind, className, glyph) => {
    const html = renderMarkup(<StatusPill kind={kind}>Word</StatusPill>);

    expect(elementsWithClass(html, "pill", className)).toHaveLength(1);
    expect(textOf(html)).toBe("Word");
    if (glyph === null) expect(elementsByTag(html, "svg")).toEqual([]);
    else expect(html).toContain(glyph);
  });

  it("keeps the glyph out of what a screen reader says", () => {
    const html = renderMarkup(<StatusPill kind="done">Done by Sam</StatusPill>);

    expect(elementsByTag(html, "svg")[0]?.attributes["aria-hidden"]).toBe("true");
  });

  it("comes in the small size for cards", () => {
    const html = renderMarkup(
      <StatusPill kind="label" small>
        Day-to-day
      </StatusPill>
    );

    expect(elementsWithClass(html, "pill", "pill-outline", "pill-s")).toHaveLength(1);
  });
});
