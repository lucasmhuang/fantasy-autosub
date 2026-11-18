import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { Button } from "./button";

// Path data from the design system's icon set.
const CHEVRON_RIGHT = 'd="M9 6l6 6-6 6"';
const CHEVRON_LEFT = 'd="M15 6l-6 6 6 6"';

describe("Button", () => {
  it("renders a button with its text and type", () => {
    const markup = renderMarkup(
      <Button variant="secondary" type="submit">
        Save
      </Button>
    );

    expect(markup).toMatch(/^<button [^>]*type="submit"[^>]*>Save<\/button>$/);
  });

  it("renders the screen's primary action as the system's button, chevron last when it opens the next step", () => {
    const html = renderMarkup(
      <Button asChild variant="primary" next>
        <a href="/app/requests/new">Choose a replacement</a>
      </Button>
    );

    expect(elementsWithClass(html, "btn")).toEqual([
      { tag: "a", attributes: { class: "btn", href: "/app/requests/new" } },
    ]);
    expect(html.indexOf("Choose a replacement")).toBeLessThan(html.indexOf(CHEVRON_RIGHT));
  });

  it("renders Confirm as the large button, the amount in its label", () => {
    const html = renderMarkup(
      <Button variant="confirm" type="submit">
        Confirm swap · −87.8
      </Button>
    );

    expect(elementsWithClass(html, "btn", "btn-l")[0]?.tag).toBe("button");
    expect(textOf(html)).toBe("Confirm swap · −87.8");
  });

  it("while busy, marks itself busy and says what is happening instead of its label", () => {
    const html = renderMarkup(
      <Button variant="confirm" type="submit" busyLabel="Checking ESPN…">
        Confirm swap · −87.8
      </Button>
    );

    expect(elementsWithClass(html, "btn-l")[0]?.attributes["aria-busy"]).toBe("true");
    expect(elementsWithClass(html, "spin-ink")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(elementsWithClass(html, "lbl-wrap")).toHaveLength(1);
    expect(textOf(html)).toBe("Checking ESPN…");
  });

  it("renders the secondary, back and quiet buttons with the system's classes", () => {
    const secondary = renderMarkup(<Button variant="secondary">Withdraw request</Button>);
    const back = renderMarkup(
      <Button asChild variant="ghost" back>
        <a href="/app">Team</a>
      </Button>
    );
    const quiet = renderMarkup(
      <Button asChild variant="quiet">
        <a href="/app">Back to options</a>
      </Button>
    );

    expect(elementsWithClass(secondary, "btn-sec")[0]?.tag).toBe("button");
    expect(elementsWithClass(back, "btn-ghost", "is-back")[0]?.attributes.href).toBe("/app");
    expect(back.indexOf(CHEVRON_LEFT)).toBeLessThan(back.indexOf("Team"));
    expect(elementsWithClass(quiet, "btn-quiet")[0]?.attributes.href).toBe("/app");
  });

  it("puts an icon before the label of a ghost button", () => {
    const html = renderMarkup(
      <Button variant="ghost" icon="refresh">
        Refresh
      </Button>
    );

    expect(elementsWithClass(html, "ico")[0]?.tag).toBe("svg");
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("Refresh"));
  });
});
