import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { Notice, type NoticeTone } from "./notice";

const WARNING_GLYPH = 'd="M12 3.5l9 16h-18z"';
const INFO_GLYPH = 'd="M12 8v4.5"';
const TONES: [NoticeTone, string][] = [
  ["wait", WARNING_GLYPH],
  ["info", INFO_GLYPH],
  ["fail", WARNING_GLYPH],
  ["taken", INFO_GLYPH],
];

describe("Notice", () => {
  it.each(TONES)("shows a %s notice in its tone, with its glyph", (tone, glyph) => {
    const html = renderMarkup(
      <Notice tone={tone}>Your commissioner approves each request.</Notice>
    );

    expect(elementsWithClass(html, "notice", `notice-${tone}`)).toHaveLength(1);
    expect(html).toContain(glyph);
    expect(textOf(html)).toBe("Your commissioner approves each request.");
  });

  it("gives a failure its own way out", () => {
    const html = renderMarkup(
      <Notice tone="fail" action={{ label: "Try again", href: "/commish/requests" }}>
        Couldn't load the queue.
      </Notice>
    );

    expect(elementsWithClass(html, "act")).toEqual([
      { tag: "a", attributes: expect.objectContaining({ href: "/commish/requests" }) },
    ]);
    expect(textOf(html)).toBe("Couldn't load the queue.Try again");
  });

  // FS-LAYOUT-2: the system draws the link one text line tall (about 19 px), so a pseudo-element
  // 44 px tall, centred on it, takes the touch without changing the drawing.
  it("makes its action a 44 px touch target", () => {
    const html = renderMarkup(
      <Notice tone="fail" action={{ label: "Try again", href: "/commish/requests" }}>
        Couldn't load the queue.
      </Notice>
    );

    expect(elementsWithClass(html, "act")[0]?.attributes.class?.split(" ")).toEqual(
      expect.arrayContaining([
        "relative",
        "before:absolute",
        "before:inset-x-0",
        "before:top-1/2",
        "before:h-11",
        "before:-translate-y-1/2",
      ])
    );
  });

  it("is announced politely only when it reports a change", () => {
    const quiet = renderMarkup(<Notice tone="info">Nothing changes on ESPN.</Notice>);
    const announced = renderMarkup(
      <Notice tone="info" announce>
        Can't reach ESPN right now.
      </Notice>
    );

    expect(elementsWithClass(quiet, "notice")[0]?.attributes.role).toBeUndefined();
    expect(elementsWithClass(announced, "notice")[0]?.attributes.role).toBe("status");
  });
});
