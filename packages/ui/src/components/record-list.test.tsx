import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { RecordList } from "./record-list";

describe("RecordList", () => {
  it("lists each event with its time, which never wraps", () => {
    const html = renderMarkup(
      <RecordList
        events={[
          { time: "6:41 PM PT", text: "Dana asked: Reid in for Embiid" },
          { time: "6:41 PM PT", text: "ESPN checked: Embiid OUT" },
        ]}
      />
    );

    expect(elementsWithClass(html, "ev").map(({ attributes }) => attributes.class)).toEqual([
      "ev",
      "ev",
    ]);
    expect(elementsWithClass(html, "t")).toHaveLength(2);
    expect(textOf(html)).toBe(
      "Record6:41 PM PTDana asked: Reid in for Embiid6:41 PM PTESPN checked: Embiid OUT"
    );
  });

  it("widens the time column for every row once the record spans days", () => {
    const html = renderMarkup(
      <RecordList
        events={[
          { time: "6:41 PM PT", text: "Dana asked" },
          { time: "Thu 10:20 AM PT", text: "Sam settled it by hand" },
        ]}
      />
    );

    expect(elementsWithClass(html, "ev", "is-days")).toHaveLength(2);
  });

  it("can sit behind a Full record disclosure that counts its events", () => {
    const html = renderMarkup(
      <RecordList
        collapsed
        events={[
          { time: "Wed 6:41 PM PT", text: "Dana asked" },
          { time: "Wed 6:42 PM PT", text: "ESPN confirmed" },
          { time: "Thu 9:00 AM PT", text: "Week 4 ended" },
        ]}
      />
    );

    expect(elementsByTag(html, "details")).toHaveLength(1);
    expect(elementsWithClass(html, "disclosure")[0]?.tag).toBe("summary");
    expect(textOf(html).startsWith("Full record · 3 events")).toBe(true);
    expect(elementsWithClass(html, "ev")).toHaveLength(3);
  });
});
