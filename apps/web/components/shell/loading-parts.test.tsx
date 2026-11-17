import { describe, expect, it } from "vitest";
import TeamLoading from "../../app/(app)/app/loading";
import { elementsWithClass, renderMarkup } from "../test-support";
import { AutomationStripPlaceholder } from "./loading-parts";

// IF-LOAD-1, found by the staging walk: placeholders as tall as what replaces them.
describe("the loading states' placeholders", () => {
  // With automation on (production's state) the line carries its switch, which sets its height.
  it("gives the automation line's placeholder the switch's room, unseen", () => {
    const html = renderMarkup(<AutomationStripPlaceholder />);
    const [room] = elementsWithClass(html, "switch");

    expect(room?.attributes.class).toContain("invisible");
    expect(elementsWithClass(html, "autostrip")[0]?.attributes["aria-hidden"]).toBe("true");
  });

  it("draws the team page's headline placeholder in the headline's own type", () => {
    const html = renderMarkup(<TeamLoading />);

    expect(elementsWithClass(html, "headline")).toHaveLength(1);
    expect(elementsWithClass(html, "t-headline")).toHaveLength(1);
  });
});
