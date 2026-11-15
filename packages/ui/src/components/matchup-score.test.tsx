import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { MatchupScore } from "./matchup-score";

const WEEK = "Week 4 · Mon Nov 9 – Sun Nov 15";

describe("MatchupScore", () => {
  it("shows ESPN's total for each side, and today's live points beside ours, labelled", () => {
    const html = renderMarkup(
      <MatchupScore
        week={WEEK}
        mine={{ name: "Glass Cannons", total: "537.7", today: "+110.5 today, live" }}
        opponent={{ name: "Pick & Roll Call", total: "561.2", today: "+86.4 today, live" }}
        note="ESPN's total counts complete days. Today's live points sit beside it until the day ends."
      />
    );

    expect(elementsWithClass(html, "panel")[0]?.attributes["aria-label"]).toBe(
      "This week's matchup"
    );
    expect(elementsWithClass(html, "t-score")).toHaveLength(2);
    expect(elementsWithClass(html, "team", "ellipsis")).toHaveLength(2);
    expect(elementsWithClass(html, "live")).toHaveLength(1);
    expect(textOf(html)).toBe(
      `${WEEK}Glass Cannons537.7+110.5 today, livevsPick & Roll Call561.2+86.4 today, liveESPN's total counts complete days. Today's live points sit beside it until the day ends.`
    );
  });

  it("says when there is no opponent this week", () => {
    const html = renderMarkup(
      <MatchupScore week={WEEK} mine={{ name: "Glass Cannons", total: "0.0" }} opponent={null} />
    );

    expect(elementsWithClass(html, "live")).toEqual([]);
    expect(textOf(html)).toBe(`${WEEK}Glass Cannons0.0vsNo opponent—Bye this week`);
  });
});
