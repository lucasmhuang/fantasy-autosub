import { describe, expect, it } from "vitest";
import { elementsByTag, renderMarkup, textOf } from "../test-support";
import { HeadlineAnswer } from "./headline-answer";

const LAG = "Ruled OUT a few minutes ago? ESPN can take a few minutes to show it.";

describe("HeadlineAnswer", () => {
  it.each([
    [1, 0, "1 starter is OUT", "t-headline is-out"],
    [2, 1, "2 starters are OUT", "t-headline is-out"],
    [0, 1, "1 starter is suspended", "t-headline is-susp"],
    [0, 2, "2 starters are suspended", "t-headline is-susp"],
    [0, 0, "No starters are OUT", "t-headline"],
  ])("with %i OUT and %i suspended, answers %s", (out, suspended, words, className) => {
    const html = renderMarkup(<HeadlineAnswer out={out} suspended={suspended} sentence={LAG} />);

    expect(elementsByTag(html, "h1")[0]?.attributes.class).toBe(className);
    expect(textOf(html)).toBe(`${words}${LAG}`);
  });

  it("leaves the line out when there's nothing to add", () => {
    const html = renderMarkup(<HeadlineAnswer out={1} suspended={0} />);

    expect(elementsByTag(html, "p")).toEqual([]);
    expect(textOf(html)).toBe("1 starter is OUT");
  });
});
