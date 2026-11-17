import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { type NavItem, TabBar, TopBar } from "./tab-bar";

const COMMISSIONER: NavItem[] = [
  { key: "team", label: "Team", href: "/app", icon: "tab-team" },
  { key: "requests", label: "Requests", href: "/app/requests", icon: "tab-requests" },
  { key: "queue", label: "Queue", href: "/commish/requests", icon: "tab-queue", count: 3 },
  { key: "file", label: "File", href: "/commish/requests/new", icon: "tab-file" },
  { key: "settings", label: "Settings", href: "/commish/settings", icon: "tab-settings" },
];

function hrefsOf(markup: string): (string | undefined)[] {
  return elementsByTag(markup, "a").map(({ attributes }) => attributes.href);
}

describe("TabBar", () => {
  it("shows every destination, labelled, in order, the current one marked", () => {
    const html = renderMarkup(<TabBar items={COMMISSIONER} current="queue" />);

    expect(elementsByTag(html, "nav")[0]?.attributes).toMatchObject({
      class: "tabbar",
      "aria-label": "Main",
      style: "--tabs:5",
    });
    expect(elementsWithClass(html, "tab")).toHaveLength(5);
    expect(hrefsOf(html)).toEqual(COMMISSIONER.map(({ href }) => href));
    expect(textOf(html)).toBe("TeamRequests3QueueFileSettings");
    expect(
      elementsByTag(html, "a").map(({ attributes }) => attributes["aria-current"] ?? null)
    ).toEqual([null, null, "page", null, null]);
  });

  it("counts what waits on the commissioner on that tab alone, and says so", () => {
    const html = renderMarkup(<TabBar items={COMMISSIONER} current="team" />);
    const none = renderMarkup(
      <TabBar items={COMMISSIONER.map((item) => ({ ...item, count: 0 }))} current="team" />
    );

    expect(elementsWithClass(html, "badge")).toHaveLength(1);
    expect(elementsByTag(html, "a")[2]?.attributes["aria-label"]).toBe("Queue, 3 need you");
    expect(elementsWithClass(none, "badge")).toEqual([]);
    expect(elementsByTag(none, "a")[2]?.attributes["aria-label"]).toBeUndefined();
  });
});

describe("TopBar", () => {
  it("puts the same destinations in the same order beside the wordmark and the account control", () => {
    const html = renderMarkup(
      <TopBar items={COMMISSIONER} current="settings" account={<button type="button">S</button>} />
    );

    expect(elementsWithClass(html, "topbar")[0]?.tag).toBe("header");
    expect(elementsWithClass(html, "wordmark")).toHaveLength(1);
    // FS-SHELL-11: the mark before the name.
    expect(html).toMatch(
      /<span class="wordmark"><svg class="brand-mark"[\s\S]*?<\/svg>InjurySub<\/span>/
    );
    expect(elementsWithClass(html, "topnav")[0]?.attributes["aria-label"]).toBe("Main");
    expect(hrefsOf(html)).toEqual(COMMISSIONER.map(({ href }) => href));
    expect(elementsByTag(html, "a")[4]?.attributes["aria-current"]).toBe("page");
    expect(elementsWithClass(html, "badge")).toHaveLength(1);
    expect(textOf(html)).toBe("InjurySubTeamRequestsQueue3FileSettingsS");
  });
});
