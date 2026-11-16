import { describe, expect, it } from "vitest";
import { linksIn, renderMarkup } from "../test-support";
import { DatabaseDown, NotFoundView, UnexpectedFailure } from "./full-state";

const text = (markup: string) => markup.replaceAll("&#x27;", "'");
const NOTHING_LOST =
  "Nothing you filed is lost. Starter ruled OUT? Text your commissioner; they can file it with the time you asked.";

// FS-APP-1, FS-APP-3, FS-APP-4: the full pages that replace a page that can't be shown.
describe("the full pages", () => {
  it("says InjurySub can't load when its database is down, and offers to try again", () => {
    const markup = text(renderMarkup(<DatabaseDown />));

    expect(markup).toContain("Can't load InjurySub right now");
    expect(markup).toContain(NOTHING_LOST);
    expect(linksIn(markup)).toEqual([{ href: "", text: "Try again" }]);
    expect(markup).not.toContain("ESPN");
  });

  it("says something went wrong on an unexpected failure, with the retry it's given", () => {
    const markup = text(
      renderMarkup(
        <UnexpectedFailure
          retry={
            <button type="button" className="btn">
              Try again
            </button>
          }
        />
      )
    );

    expect(markup).toContain("Something went wrong on our side");
    expect(markup).toContain(NOTHING_LOST);
    expect(markup).toContain(">Try again</button>");
  });

  it("says nothing is here at an unknown address, with the way to Team", () => {
    const markup = text(renderMarkup(<NotFoundView />));

    expect(markup).toContain("Nothing here");
    expect(markup).toContain("The address may be old or mistyped.");
    expect(linksIn(markup)).toEqual([{ href: "/app", text: "Go to Team" }]);
  });
});
