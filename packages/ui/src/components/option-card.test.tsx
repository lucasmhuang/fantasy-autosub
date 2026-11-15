import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { Note } from "./note";
import { OptionCard, optionName } from "./option-card";

const REID = {
  name: "Naz Reid",
  team: "MIN",
  positions: "PF, C",
  face: { src: "/faces/reid.png" },
  average: "31.2",
  gamesLeft: "3",
  gameDays: "Wed, Fri, Sun",
  next: "Wed 4:30 PM PT vs MIA",
  href: "/app/requests/new?starter=1&replacement=2",
  label: "Naz Reid, ready now",
};

describe("OptionCard", () => {
  it("links to Confirm, named for the outcome, with the season average as its headline", () => {
    const html = renderMarkup(<OptionCard {...REID} />);

    expect(elementsWithClass(html, "ocard")[0]).toEqual({
      tag: "a",
      attributes: {
        class: "ocard",
        style: "--team:var(--team-min)",
        href: REID.href,
        "aria-label": "Naz Reid, ready now",
      },
    });
    expect(textOf(html)).toBe(
      "31.2Season avgNaz ReidMIN · PF, CGames left3 · Wed, Fri, SunNextWed 4:30 PM PT vs MIA"
    );
  });

  it("puts the live dot before Next only while the game is live, and the notes at the foot", () => {
    const quiet = renderMarkup(<OptionCard {...REID} />);
    const live = renderMarkup(
      <OptionCard
        {...REID}
        next="Live, Q3 vs MIA"
        live
        notes={<Note kind="taken">−5.7 scored before you ask won't count</Note>}
      />
    );

    expect(elementsWithClass(quiet, "live")).toEqual([]);
    expect(elementsWithClass(live, "live")).toHaveLength(1);
    expect(elementsWithClass(live, "notes")).toHaveLength(1);
    expect(elementsWithClass(live, "note", "note-taken")).toHaveLength(1);
  });

  it("is no link when the player isn't valid, and takes the Not valid finish", () => {
    const html = renderMarkup(<OptionCard {...REID} href={undefined} notValid />);

    expect(elementsWithClass(html, "ocard", "is-not-valid")[0]).toEqual({
      tag: "div",
      attributes: { class: "ocard is-not-valid", style: "--team:var(--team-min)" },
    });
  });

  it("steps a long name down to 14 px, keeping the full name in the spoken label", () => {
    const html = renderMarkup(
      <OptionCard {...REID} name="Collin Murray-Boyles" label="Collin Murray-Boyles, ready now" />
    );

    expect(elementsWithClass(html, "name", "is-step")).toHaveLength(1);
    expect(textOf(html)).toContain("Collin Murray-Boyles");
  });

  it("shows initial and surname when even 14 px won't fit, the spoken label still in full", () => {
    const html = renderMarkup(
      <OptionCard {...REID} name="Giannis Antetokounmpo" label="Giannis Antetokounmpo, ready now" />
    );

    expect(elementsWithClass(html, "ocard")[0]?.attributes["aria-label"]).toBe(
      "Giannis Antetokounmpo, ready now"
    );
    expect(textOf(html)).toContain("G. Antetokounmpo");
    expect(textOf(html)).not.toContain("Giannis");
  });
});

describe("optionName", () => {
  it.each([
    ["Naz Reid", "Naz Reid", false],
    ["Jaren Jackson Jr.", "Jaren Jackson Jr.", true],
    ["Collin Murray-Boyles", "Collin Murray-Boyles", true],
    ["Giannis Antetokounmpo", "G. Antetokounmpo", false],
    ["Nickeil Alexander-Walker", "N. Alexander-Walker", true],
  ])("shows %s as %s (14 px: %s)", (name, text, step) => {
    expect(optionName(name)).toEqual({ text, step });
  });

  it("keeps 16 characters at 16 px and 20 at 14 px", () => {
    expect(optionName("A".repeat(7) + " " + "B".repeat(8))).toEqual({
      text: `${"A".repeat(7)} ${"B".repeat(8)}`,
      step: false,
    });
    expect(optionName("A".repeat(7) + " " + "B".repeat(9)).step).toBe(true);
    expect(optionName("A".repeat(9) + " " + "B".repeat(10)).text).toBe(
      `${"A".repeat(9)} ${"B".repeat(10)}`
    );
    expect(optionName("A".repeat(10) + " " + "B".repeat(10)).text).toBe(`A. ${"B".repeat(10)}`);
  });
});
