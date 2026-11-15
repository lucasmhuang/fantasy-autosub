import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { LoadingRows, SlowNote } from "./loading";

describe("LoadingRows", () => {
  it("holds one placeholder row per slot already known, hidden from screen readers", () => {
    const html = renderMarkup(<LoadingRows slots={["PG", "SG", "G"]} />);

    expect(elementsWithClass(html, "rows")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(elementsWithClass(html, "row", "is-loading")).toHaveLength(3);
    expect(elementsWithClass(html, "row-face")).toHaveLength(3);
    expect(elementsWithClass(html, "sk")).toHaveLength(9);
    expect(textOf(html)).toBe("PGSGG");
  });
});

describe("SlowNote", () => {
  it("says what is slow in a polite live region, its spinner unspoken", () => {
    const html = renderMarkup(
      <SlowNote>Still reading ESPN. This can take up to 12 seconds.</SlowNote>
    );

    expect(elementsWithClass(html, "slow")[0]?.attributes.role).toBe("status");
    expect(elementsWithClass(html, "spin")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(textOf(html)).toBe("Still reading ESPN. This can take up to 12 seconds.");
  });
});
