import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { CardStage } from "./card-stage";

const INCOMING = {
  name: "Naz Reid",
  surname: "Reid",
  slot: "C",
  team: "MIN",
  logo: "/logos/min.png",
  face: { src: "/faces/reid.png" },
  average: "31.2",
};
const OUTGOING = { name: "Joel Embiid", surname: "Embiid", team: "PHI", face: null };

describe("CardStage", () => {
  it("is one image to a screen reader, the replacement in front", () => {
    const html = renderMarkup(<CardStage incoming={INCOMING} outgoing={OUTGOING} done={false} />);

    expect(elementsWithClass(html, "stage")[0]?.attributes).toEqual({
      class: "stage",
      role: "img",
      "aria-label": "Naz Reid's card in front, Joel Embiid's card behind",
    });
  });

  it("while ESPN hasn't confirmed: the foil unlit, the starter's card To bench", () => {
    const html = renderMarkup(<CardStage incoming={INCOMING} outgoing={OUTGOING} done={false} />);

    expect(elementsWithClass(html, "foil", "on-stage", "is-unlit")).toHaveLength(1);
    expect(elementsWithClass(html, "pcard-xs", "is-out")).toHaveLength(1);
    expect(textOf(html)).toBe("To bench31.2Reid · C");
  });

  it("at Done: the foil lit and the starter's card Bench, with no sheen unless asked", () => {
    const html = renderMarkup(<CardStage incoming={INCOMING} outgoing={OUTGOING} done />);

    expect(elementsWithClass(html, "foil", "on-stage")[0]?.attributes.class).toBe("foil on-stage");
    expect(elementsWithClass(html, "pcard-xs", "is-benched")).toHaveLength(1);
    expect(elementsWithClass(html, "sheen")).toEqual([]);
    expect(textOf(html)).toBe("Bench31.2Reid · C");
  });

  it("plays the swap only on arrival, and the sheen only when ESPN confirms with the page open", () => {
    const arriving = renderMarkup(
      <CardStage incoming={INCOMING} outgoing={OUTGOING} done={false} play />
    );
    const confirmedNow = renderMarkup(
      <CardStage incoming={INCOMING} outgoing={OUTGOING} done sheen />
    );
    const stillWaiting = renderMarkup(
      <CardStage incoming={INCOMING} outgoing={OUTGOING} done={false} sheen />
    );

    expect(elementsWithClass(arriving, "stage", "play")).toHaveLength(1);
    expect(elementsWithClass(confirmedNow, "sheen", "play")).toHaveLength(1);
    expect(elementsWithClass(confirmedNow, "pcard-s")).toHaveLength(1);
    expect(confirmedNow.indexOf("pcard-s")).toBeLessThan(confirmedNow.indexOf("sheen"));
    expect(elementsWithClass(stillWaiting, "sheen")).toEqual([]);
  });
});
