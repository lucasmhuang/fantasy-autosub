import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup } from "../test-support";
import { BrandMark } from "./brand-mark";

// FS-SHELL-11: the app's mark (step 6's icon A) beside its name, decorative.
describe("BrandMark", () => {
  it("draws the two cards for the eye only, in the system's colours", () => {
    const html = renderMarkup(<BrandMark />);
    const [mark] = elementsWithClass(html, "brand-mark");

    expect(mark?.tag).toBe("svg");
    expect(mark?.attributes["aria-hidden"]).toBe("true");
    expect(html.match(/<rect\b/g)).toHaveLength(3);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect([...html.matchAll(/fill="([^"]+)"/g)].map(([, fill]) => fill)).toEqual([
      "var(--out-frame)",
      "var(--primary)",
      "var(--ground)",
    ]);
  });
});
