import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { LineupChanges } from "./lineup-changes";

describe("LineupChanges", () => {
  it("lists each change: the slot he ends in, his face, his name and what happens", () => {
    const html = renderMarkup(
      <LineupChanges
        aside="One edit on ESPN"
        changes={[
          { slot: "C", name: "Naz Reid", team: "MIN", face: null, text: "Comes off the bench." },
          {
            slot: "BN",
            bench: true,
            out: true,
            name: "Joel Embiid",
            team: "PHI",
            face: null,
            text: "Goes to the bench.",
          },
        ]}
      />
    );

    expect(elementsWithClass(html, "lchange")).toHaveLength(2);
    expect(elementsWithClass(html, "slot-chip").map(({ attributes }) => attributes.class)).toEqual([
      "slot-chip",
      "slot-chip is-bench",
    ]);
    expect(elementsWithClass(html, "face-s").map(({ attributes }) => attributes.class)).toEqual([
      "face-s",
      "face-s is-out",
    ]);
    expect(textOf(html)).toBe(
      "Your lineup changesOne edit on ESPNCNaz ReidComes off the bench.BNJoel EmbiidGoes to the bench."
    );
  });

  it("takes the commissioner's title for what approving sends", () => {
    const html = renderMarkup(<LineupChanges title="Approving sends" changes={[]} />);

    expect(textOf(html)).toBe("Approving sends");
  });
});
