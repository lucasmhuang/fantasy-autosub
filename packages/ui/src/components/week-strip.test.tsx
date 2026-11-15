import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { WeekStrip } from "./week-strip";

describe("WeekStrip", () => {
  it("shows each day's net with its sign, a dot where nothing changed, labelled for screen readers", () => {
    const html = renderMarkup(
      <WeekStrip
        cells={[
          { day: "Mon", date: "9", net: "−52.8" },
          { day: "Tue", date: "10", net: "−35.6" },
          { day: "Wed", date: "11", net: "+26.7" },
          { day: "Thu", date: "12" },
        ]}
      />
    );

    expect(elementsWithClass(html, "strip")[0]?.attributes).toEqual({
      class: "strip",
      style: "--days:4",
      "aria-label": "Adjustment by day, net",
    });
    expect(elementsWithClass(html, "day").map(({ attributes }) => attributes.class)).toEqual([
      "day neg",
      "day neg",
      "day pos",
      "day",
    ]);
    expect(textOf(html)).toBe("Mon9−52.8Tue10−35.6Wed11+26.7Thu12·");
  });

  it("folds the All-Star break's no-game days into one cell per row", () => {
    const html = renderMarkup(
      <WeekStrip
        columns={7}
        label="Adjustment by day, net, two weeks"
        cells={[
          { day: "Mon", date: "15" },
          { day: "Tue", date: "16" },
          { day: "Wed", date: "17" },
          { day: "Thu", date: "18" },
          { title: "All-Star break", dates: "Fri 19 – Sun 21", span: 3 },
        ]}
      />
    );

    expect(elementsWithClass(html, "strip")[0]?.attributes.style).toBe("--days:7");
    expect(elementsWithClass(html, "day-break")[0]?.attributes.style).toBe("grid-column:span 3");
    expect(textOf(html)).toContain("All-Star breakFri 19 – Sun 21");
  });
});
