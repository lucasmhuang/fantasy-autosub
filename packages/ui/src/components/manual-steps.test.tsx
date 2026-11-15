import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { ManualSteps } from "./manual-steps";

describe("ManualSteps", () => {
  it("numbers the steps from a live ESPN read, each value to type in a copy field", () => {
    const html = renderMarkup(
      <ManualSteps
        readAt="From ESPN Wed 6:44 PM PT"
        steps={[
          {
            title: "Lineup, Half-Court Heroes, Wed Nov 11",
            text: "In League Manager tools, edit the lineup for that day.",
            moves: [
              { text: "Nesmith BN → F", team: "IND", face: null },
              { text: "Brown F → BN", team: "PHI", face: null, out: true },
            ],
          },
          {
            title: "Adjustment on ESPN's Scoreboard",
            text: "Open Matchup 4, then Adjust Scoring on Half-Court Heroes' pairing.",
            value: { text: "−31.4", action: <button type="button">Copy</button> },
          },
          {
            title: "Note (the whole league sees it on ESPN)",
            value: { text: "Injury sub requested…", long: true },
          },
        ]}
      />
    );

    expect(elementsWithClass(html, "hstep")).toHaveLength(3);
    expect(elementsWithClass(html, "n").map(({ attributes }) => attributes.class)).toEqual([
      "n",
      "n",
      "n",
    ]);
    expect(elementsWithClass(html, "move")).toHaveLength(2);
    expect(elementsWithClass(html, "face-s").map(({ attributes }) => attributes.class)).toEqual([
      "face-s",
      "face-s is-out",
    ]);
    expect(elementsWithClass(html, "copyval")).toHaveLength(2);
    expect(elementsWithClass(html, "long")).toHaveLength(1);
    expect(textOf(html)).toContain(
      "By hand on ESPNFrom ESPN Wed 6:44 PM PT1Lineup, Half-Court Heroes"
    );
    expect(textOf(html)).toContain("2Adjustment on ESPN's Scoreboard");
    expect(textOf(html)).toContain("−31.4Copy3Note");
  });

  it("checks a step off once InjurySub reads it back", () => {
    const html = renderMarkup(
      <ManualSteps
        readAt="From ESPN Wed 6:44 PM PT"
        steps={[
          { title: "Lineup, Half-Court Heroes, Wed Nov 11", done: true },
          { title: "Then mark it done here" },
        ]}
      />
    );

    expect(elementsWithClass(html, "n").map(({ attributes }) => attributes.class)).toEqual([
      "n done",
      "n",
    ]);
    expect(html).toContain('d="M5 12.5l4.5 4.5L19 7.5"');
    expect(textOf(html)).toContain("Lineup, Half-Court Heroes, Wed Nov 112Then mark it done here");
  });
});
