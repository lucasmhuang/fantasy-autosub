import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { type AdjustmentLine, AdjustmentPanel } from "./adjustment-panel";

const LINES: AdjustmentLine[] = [
  { who: "Embiid · Mon Nov 9", amount: "−46.5", kind: "start" },
  { who: "Embiid · Tue Nov 10", amount: "−35.6", kind: "start" },
  { who: "Reid · Wed Nov 11", amount: "−5.7", kind: "before" },
];

describe("AdjustmentPanel", () => {
  it("shows the signed total, labelled Projected, then a line for each credit and deduction", () => {
    const html = renderMarkup(
      <AdjustmentPanel
        total="−87.8"
        state="Projected"
        lines={LINES}
        foot="Can change until the swap shows on ESPN."
      />
    );

    expect(elementsWithClass(html, "state")[0]?.attributes.class).toBe("state");
    expect(elementsWithClass(html, "t-total", "adj-total")[0]?.attributes.class).toBe(
      "t-total adj-total"
    );
    expect(elementsWithClass(html, "amt").map(({ attributes }) => attributes.class)).toEqual([
      "amt neg",
      "amt neg",
      "amt neg",
    ]);
    expect(textOf(html)).toBe(
      "AdjustmentProjected−87.8Embiid · Mon Nov 9−46.5Forfeited while startingEmbiid · Tue Nov 10−35.6Forfeited while startingReid · Wed Nov 11−5.7Before you asked: doesn't countCan change until the swap shows on ESPN."
    );
  });

  it("words each line about the request for the commissioner, never as the manager's you", () => {
    const html = renderMarkup(
      <AdjustmentPanel
        total="+5.1"
        state="Final"
        reader="commissioner"
        lines={[
          { who: "Reid · Tue Nov 10", amount: "+17.7", kind: "bench" },
          { who: "Reid · Wed Nov 11", amount: "+2.0", kind: "after" },
          { who: "Reid · Wed Nov 11", amount: "−5.7", kind: "before" },
        ]}
      />
    );

    const text = textOf(html);
    expect(text).toContain("On the bench, after the request");
    expect(text).toContain("After the request");
    expect(text).toContain("Before the request: doesn't count");
    expect(text).not.toContain("you asked");
  });

  it("says Final in green once ESPN shows the day, and colours a positive total", () => {
    const html = renderMarkup(
      <AdjustmentPanel
        total="+5.1"
        state="Final"
        lines={[
          { who: "Camara · Tue Oct 27", amount: "+17.7", kind: "bench" },
          { who: "Jackson · Mon Oct 26", amount: "−12.6", kind: "start" },
          { who: "Reid · Wed", amount: "0.0", kind: "after" },
        ]}
      />
    );

    expect(elementsWithClass(html, "state", "final")).toHaveLength(1);
    expect(elementsWithClass(html, "adj-total", "pos")).toHaveLength(1);
    expect(elementsWithClass(html, "amt").map(({ attributes }) => attributes.class)).toEqual([
      "amt pos",
      "amt neg",
      "amt zero",
    ]);
  });

  it("colours a line negative whichever minus sign it carries", () => {
    const html = renderMarkup(
      <AdjustmentPanel
        total="-5.1"
        state="Projected"
        lines={[
          { who: "Embiid · Mon Nov 9", amount: "-5.1", kind: "start" },
          { who: "Reid · Wed Nov 11", amount: "−5.7", kind: "before" },
        ]}
      />
    );

    expect(elementsWithClass(html, "amt").map(({ attributes }) => attributes.class)).toEqual([
      "amt neg",
      "amt neg",
    ]);
  });

  it("keeps six or more lines in the panel, every one shown", () => {
    const many = Array.from({ length: 7 }, (_, day) => ({
      who: `Embiid · day ${day}`,
      amount: "−1.0",
      kind: "start" as const,
    }));
    const html = renderMarkup(<AdjustmentPanel total="−7.0" state="Projected" lines={many} />);

    expect(elementsWithClass(html, "adj-line")).toHaveLength(7);
    expect(html).not.toMatch(/overflow|max-h/);
  });

  // FS-REQUEST-15: a reversal's one line says what it cancels.
  it("gives a line its own words where no kind fits", () => {
    const html = renderMarkup(
      <AdjustmentPanel
        total="+87.8"
        state="Final"
        lines={[
          { who: "Reversal · Thu Nov 12", amount: "+87.8", note: "Cancels the −87.8 adjustment" },
        ]}
      />
    );

    expect(textOf(html)).toBe(
      "AdjustmentFinal+87.8Reversal · Thu Nov 12+87.8Cancels the −87.8 adjustment"
    );
  });

  it("says no adjustment instead of a zero total when nothing is owed", () => {
    const html = renderMarkup(
      <AdjustmentPanel
        total={null}
        state="Projected"
        lines={[]}
        foot="Embiid hadn't played this week, so nothing is owed."
      />
    );

    expect(elementsWithClass(html, "t-total")).toEqual([]);
    expect(elementsByTag(html, "section")[0]?.attributes["aria-labelledby"]).toBe("adjustment");
    expect(textOf(html)).toBe(
      "AdjustmentProjectedNo adjustmentEmbiid hadn't played this week, so nothing is owed."
    );
  });
});
