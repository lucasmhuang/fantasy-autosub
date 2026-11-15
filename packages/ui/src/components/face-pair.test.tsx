import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup } from "../test-support";
import { FacePair, SmallFace } from "./face-pair";

describe("FacePair", () => {
  it("puts the replacement in front and the starter dimmed behind, hidden from screen readers", () => {
    const html = renderMarkup(
      <FacePair
        incoming={{ team: "MIN", face: { src: "/faces/reid.png" } }}
        outgoing={{ team: "PHI", face: null }}
      />
    );

    expect(elementsWithClass(html, "face-pair")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(elementsWithClass(html, "face-s").map(({ attributes }) => attributes)).toEqual([
      { class: "face-s is-out", style: "--team:var(--team-phi)" },
      { class: "face-s", style: "--team:var(--team-min)" },
    ]);
  });
});

describe("SmallFace", () => {
  it("shows a face on its team's ground, or the silhouette", () => {
    const html = renderMarkup(<SmallFace team="MIN" face={null} />);

    expect(elementsWithClass(html, "face-s")[0]?.attributes.style).toBe("--team:var(--team-min)");
    expect(elementsWithClass(html, "sil")).toHaveLength(1);
  });
});
