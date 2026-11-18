import { describe, expect, it } from "vitest";
import { linksIn, renderMarkup } from "../test-support";
import { DatabaseDown, NotFoundView, RequestNotFound, UnexpectedFailure } from "./full-state";

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

  // Copy table 1, S4: the commissioner isn't told to text the commissioner.
  it("gives the commissioner only the headline and Try again", () => {
    const markup = text(renderMarkup(<DatabaseDown commissioner />));

    expect(markup).toContain("Can't load InjurySub right now");
    expect(markup).not.toContain("commissioner");
    expect(markup).not.toContain("<p>");
    expect(linksIn(markup)).toEqual([{ href: "", text: "Try again" }]);
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

    expect(markup).toContain("Something went wrong");
    expect(markup).not.toContain("on our side");
    // Copy table 2: "nothing is lost" holds for a database outage, not any failure.
    expect(markup).not.toContain("Nothing you filed is lost");
    expect(markup).toContain("Starter ruled OUT? Text your commissioner");
    expect(markup).toContain(">Try again</button>");
  });

  it("says nothing is here at an unknown address, with the way to Team", () => {
    const markup = text(renderMarkup(<NotFoundView />));

    expect(markup).toContain("Nothing here");
    expect(markup).toContain("The address may be old or mistyped.");
    expect(linksIn(markup)).toEqual([{ href: "/app", text: "Go to Team" }]);
  });

  // Copy table 2: a request that isn't the team's says so in its title alone.
  it("says no request is here, with no sentence under it", () => {
    const markup = text(renderMarkup(<RequestNotFound />));

    expect(markup).toContain("No request here");
    expect(markup).not.toContain("<p>");
  });
});
