import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { OutCard } from "./out-card";

const EMBIID = {
  name: "Joel Embiid",
  slot: "C",
  face: { src: "/faces/embiid.png" },
  teamLine: "PHI · C",
  nextGame: "Next game Thu 7:00 PM PT vs BOS",
  forfeit: "82.1",
  days: ["Mon 46.5", "Tue 35.6"],
  games: "2 games",
  stats: [
    { label: "PTS", value: "44" },
    { label: "REB", value: "18" },
    { label: "AST", value: "7" },
    { label: "STL", value: "1" },
    { label: "BLK", value: "3" },
    { label: "TO", value: "6" },
  ],
};

describe("OutCard", () => {
  it("makes the forfeit the biggest number, under what it means", () => {
    const html = renderMarkup(<OutCard {...EMBIID}>action</OutCard>);

    expect(elementsWithClass(html, "out-card")[0]?.attributes).toEqual({
      class: "out-card",
      "aria-label": "Joel Embiid, OUT",
    });
    expect(elementsWithClass(html, "t-forfeit")).toHaveLength(1);
    expect(elementsWithClass(html, "pill", "pill-out")).toHaveLength(1);
    expect(textOf(html)).toContain(
      "COUTJoel EmbiidPHI · CNext game Thu 7:00 PM PT vs BOSA swap forfeits82.1pts"
    );
  });

  it("lists his points while starting by day, the week's stat line, then the action", () => {
    const html = renderMarkup(<OutCard {...EMBIID}>action</OutCard>);

    expect(textOf(html)).toContain("While starting: Mon 46.5 · Tue 35.6 · 2 games");
    expect(elementsWithClass(html, "stat-strip")[0]?.attributes["aria-label"]).toBe(
      "This week's stat line, 2 games"
    );
    expect(textOf(html).endsWith("44PTS18REB7AST1STL3BLK6TOaction")).toBe(true);
  });

  it("says when he has no points yet this week", () => {
    const html = renderMarkup(
      <OutCard {...EMBIID} days={[]}>
        action
      </OutCard>
    );

    expect(textOf(html)).toContain("No points yet this week");
    expect(textOf(html)).not.toContain("While starting");
  });

  it("frames a suspended starter in amber and says a swap would forfeit, if made", () => {
    const html = renderMarkup(
      <OutCard {...EMBIID} suspended>
        action
      </OutCard>
    );

    expect(elementsWithClass(html, "out-card", "is-susp")[0]?.attributes["aria-label"]).toBe(
      "Joel Embiid, suspended"
    );
    expect(elementsWithClass(html, "pill", "pill-wait")).toHaveLength(1);
    expect(elementsWithClass(html, "out-label", "text-wait")).toHaveLength(1);
    expect(textOf(html)).toContain("If swapped, forfeits");
  });

  it("draws the silhouette in the art when there is no headshot", () => {
    const html = renderMarkup(
      <OutCard {...EMBIID} face={null}>
        action
      </OutCard>
    );

    expect(elementsByTag(html, "img")).toEqual([]);
    expect(elementsWithClass(html, "hs", "sil")).toHaveLength(1);
  });
});
