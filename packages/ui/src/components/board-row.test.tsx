import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { BoardRow, BoardRowGap } from "./board-row";

const CURRY = {
  slot: "G",
  name: "Stephen Curry",
  team: "GS",
  logo: "/logos/gs.png",
  face: { src: "/faces/curry.png" },
  meta: "GS · 7:00 PM PT vs SAC",
  weekPoints: "47.9",
  average: "45.2",
};

describe("BoardRow", () => {
  it("shows the slot over the team's faint logo, the face, name, meta and both numbers", () => {
    const html = renderMarkup(<BoardRow {...CURRY} />);

    expect(elementsWithClass(html, "row")[0]?.attributes.style).toBe("--team:var(--team-gs)");
    expect(elementsWithClass(html, "row-logo")).toEqual([
      { tag: "img", attributes: { class: "row-logo", src: "/logos/gs.png", alt: "" } },
    ]);
    expect(elementsWithClass(html, "row-face")).toHaveLength(1);
    expect(elementsWithClass(html, "row-name", "ellipsis")).toHaveLength(1);
    expect(textOf(html)).toBe("GStephen CurryGS · 7:00 PM PT vs SAC47.9avg 45.2");
  });

  it("puts the live dot first, then Day-to-day, and dims a bench row", () => {
    const html = renderMarkup(<BoardRow {...CURRY} live dayToDay bench />);

    expect(elementsWithClass(html, "row", "is-bench")).toHaveLength(1);
    expect(html.indexOf('class="live"')).toBeLessThan(html.indexOf("Day-to-day"));
    expect(textOf(html)).toContain("Day-to-day · GS · 7:00 PM PT vs SAC");
  });

  it("shows only the tip time and no live dot when the game state can't be read", () => {
    const html = renderMarkup(<BoardRow {...CURRY} meta="GS · 4:30 PM PT @ CHA" />);

    expect(elementsWithClass(html, "live")).toEqual([]);
    expect(textOf(html)).toContain("GS · 4:30 PM PT @ CHA");
  });

  it("leaves a free agent's row neutral, with the slot label alone", () => {
    const html = renderMarkup(<BoardRow {...CURRY} team="FA" logo={null} face={null} />);

    expect(elementsWithClass(html, "row")[0]?.attributes.style).toBeUndefined();
    expect(elementsWithClass(html, "row-logo")).toEqual([]);
    expect(elementsByTag(html, "svg")[0]?.attributes["aria-label"]).toBe("No headshot yet");
  });
});

describe("BoardRowGap", () => {
  it("holds an OUT starter's slot as a gap labelled OUT, with no logo", () => {
    const html = renderMarkup(<BoardRowGap slot="C" name="Joel Embiid" weekPoints="82.1" />);

    expect(elementsWithClass(html, "row-gap")[0]?.attributes.class).toBe("row-gap");
    expect(elementsWithClass(html, "row-logo")).toEqual([]);
    expect(textOf(html)).toBe("CJoel EmbiidOUT82.1");
  });

  it("makes a suspended starter's gap amber, labelled Suspended", () => {
    const html = renderMarkup(
      <BoardRowGap slot="C" name="Joel Embiid" weekPoints="82.1" suspended />
    );

    expect(elementsWithClass(html, "row-gap", "is-susp")).toHaveLength(1);
    expect(textOf(html)).toBe("CJoel EmbiidSuspended82.1");
  });
});
