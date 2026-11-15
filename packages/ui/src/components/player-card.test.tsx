import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { Foil, PlayerCard } from "./player-card";

const REID = {
  surname: "Reid",
  team: "MIN",
  logo: "/logos/min.png",
  face: { src: "/faces/reid.png" },
  number: "31.2",
};

describe("PlayerCard", () => {
  it("shows the season average top left, the team logo in the corner and the surname on the bar", () => {
    const html = renderMarkup(
      <PlayerCard size="m" {...REID} numberLabel="Season avg" fact="C · MIN · 3 games left" />
    );

    expect(elementsWithClass(html, "pcard")[0]?.attributes).toEqual({
      class: "pcard pcard-m",
      style: "--team:var(--team-min)",
    });
    expect(elementsWithClass(html, "corner")[0]?.attributes.src).toBe("/logos/min.png");
    expect(elementsWithClass(html, "stamp")).toEqual([]);
    expect(textOf(html)).toBe("31.2Season avgReidC · MIN · 3 games left");
  });

  it("gives an OUT starter the OUT finish: the stamp instead of the logo, the forfeit as headline", () => {
    const html = renderMarkup(
      <PlayerCard size="m" {...REID} finish="out" numberLabel="Forfeits" fact="C · PHI" />
    );

    expect(elementsWithClass(html, "pcard", "is-out")).toHaveLength(1);
    expect(elementsWithClass(html, "corner")).toEqual([]);
    expect(textOf(html)).toBe("OUT31.2ForfeitsReidC · PHI");
  });

  it("stamps a suspended starter SUSP", () => {
    const html = renderMarkup(
      <PlayerCard size="m" {...REID} finish="suspended" numberLabel="Forfeits" />
    );

    expect(elementsWithClass(html, "pcard", "is-susp")).toHaveLength(1);
    expect(elementsWithClass(html, "stamp").length).toBe(1);
    expect(textOf(html)).toContain("SUSP");
  });

  it("bands the outgoing stage card To bench, then Bench once benched, with no corner", () => {
    const toBench = renderMarkup(<PlayerCard size="xs" {...REID} finish="out" band="To bench" />);
    const benched = renderMarkup(<PlayerCard size="xs" {...REID} finish="benched" band="Bench" />);

    expect(elementsWithClass(toBench, "bar", "band-out")).toHaveLength(1);
    expect(elementsWithClass(toBench, "corner")).toEqual([]);
    expect(elementsWithClass(toBench, "stamp")).toEqual([]);
    expect(elementsWithClass(benched, "pcard", "is-benched")).toHaveLength(1);
    expect(elementsWithClass(benched, "band-out")).toEqual([]);
    expect(textOf(benched)).toBe("Bench");
  });

  it("draws the silhouette, keeping the corner logo, when there is no headshot", () => {
    const html = renderMarkup(
      <PlayerCard size="m" {...REID} face={null} numberLabel="Season avg" />
    );

    expect(elementsByTag(html, "img").map(({ attributes }) => attributes.class)).toEqual([
      "corner",
    ]);
    expect(elementsWithClass(html, "hs", "sil")).toHaveLength(1);
  });
});

describe("Foil", () => {
  it("stays unlit until ESPN confirms the swap, then lights", () => {
    const waiting = renderMarkup(
      <Foil confirmed={false}>
        <PlayerCard size="s" {...REID} band="Reid · C" />
      </Foil>
    );
    const done = renderMarkup(
      <Foil confirmed>
        <PlayerCard size="s" {...REID} band="Reid · C" />
      </Foil>
    );

    expect(elementsWithClass(waiting, "foil")[0]?.attributes.class).toBe("foil is-unlit");
    expect(elementsWithClass(done, "foil")[0]?.attributes.class).toBe("foil");
  });
});
