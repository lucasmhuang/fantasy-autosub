import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { AutomationLine } from "./automation-line";

describe("AutomationLine", () => {
  it("says automation is on, with its mode, and its switch posts to turn it off", () => {
    const html = renderMarkup(
      <AutomationLine on detail="approval required, 12 teams" action="/commish/automation/off" />
    );

    expect(elementsWithClass(html, "autostrip")[0]?.attributes.class).toBe("autostrip");
    expect(elementsByTag(html, "form")).toEqual([
      { tag: "form", attributes: { method: "post", action: "/commish/automation/off" } },
    ]);
    expect(elementsWithClass(html, "switch")[0]?.attributes).toMatchObject({
      type: "submit",
      role: "switch",
      "aria-checked": "true",
      "aria-labelledby": "automation-label",
    });
    expect(elementsWithClass(html, "lbl")[0]?.attributes.id).toBe("automation-label");
    expect(textOf(html)).toBe("Automation on · approval required, 12 teams");
  });

  it("says automation is off in the waiting colour", () => {
    const html = renderMarkup(
      <AutomationLine
        on={false}
        detail="every request comes to you"
        action="/commish/automation/on"
      />
    );

    expect(elementsWithClass(html, "autostrip", "is-off")).toHaveLength(1);
    expect(elementsWithClass(html, "switch")[0]?.attributes["aria-checked"]).toBe("false");
    expect(textOf(html)).toBe("Automation off · every request comes to you");
  });

  it("has no switch when there is nothing for it to restore", () => {
    const html = renderMarkup(<AutomationLine on={false} detail="no team is ticked in Settings" />);

    expect(elementsByTag(html, "form")).toEqual([]);
    expect(elementsWithClass(html, "switch")).toEqual([]);
    expect(textOf(html)).toBe("Automation off · no team is ticked in Settings");
  });
});

describe("AutomationLine on any commissioner page", () => {
  it("posts the page it's on, so the switch comes back there", () => {
    const html = renderMarkup(
      <AutomationLine
        on
        detail="auto, 12 teams"
        action="/commish/automation/off"
        from="/commish/settings"
      />
    );

    expect(elementsByTag(html, "input")).toEqual([
      { tag: "input", attributes: { type: "hidden", name: "from", value: "/commish/settings" } },
    ]);
  });

  it("says it can't be read, with no switch, when the settings can't be read", () => {
    const html = renderMarkup(<AutomationLine unread detail="can't be read right now" />);

    expect(elementsWithClass(html, "autostrip", "is-off")).toHaveLength(1);
    expect(elementsByTag(html, "form")).toEqual([]);
    expect(textOf(html)).toBe("Automation · can't be read right now");
  });
});
