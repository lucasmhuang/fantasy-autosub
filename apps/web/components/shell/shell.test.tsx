import { describe, expect, it } from "vitest";
import type { ShellData } from "../../lib/server/shell";
import { elementsWithClass, formsIn, linksIn, renderMarkup } from "../test-support";
import { Shell } from "./shell";

const manager: ShellData = {
  account: { initial: "D", email: "dana@example.com", team: "Team 7" },
  commissioner: false,
  commissionerName: null,
  waiting: null,
  bar: null,
  zone: null,
};
const commissioner: ShellData = { ...manager, commissioner: true, waiting: 3 };

const render = (shell: ShellData, current: Parameters<typeof Shell>[0]["current"] = "team") =>
  renderMarkup(
    <Shell shell={shell} current={current}>
      <p>page</p>
    </Shell>
  ).replaceAll("&#x27;", "'");

// Each nav (the phone's tab bar and the desktop top bar) lists the same links.
const navLinks = (markup: string) => {
  const tabbar = markup.slice(markup.indexOf('class="tabbar"'));
  return linksIn(tabbar.slice(0, tabbar.indexOf("</nav>")));
};

// FS-SHELL-1 to -3, -6, -9, IF-SHELL-1, -2.
describe("Shell", () => {
  // IF-MOTION-10: a page with a loading state fades in as it replaces the placeholders; the rest
  // change at once (IF-MOTION-12).
  it("marks a page that replaces a loading state, and only that one", () => {
    const arriving = renderMarkup(
      <Shell shell={manager} current="team" arrives>
        <p>page</p>
      </Shell>
    );

    expect(elementsWithClass(arriving, "shell-main", "arrives")).toHaveLength(1);
    expect(elementsWithClass(render(manager), "arrives")).toHaveLength(0);
  });

  it("gives a manager Team and Requests", () => {
    expect(navLinks(render(manager)).map((link) => [link.text, link.href])).toEqual([
      ["Team", "/app"],
      ["Requests", "/app/requests"],
    ]);
  });

  it("gives the commissioner five destinations, in order", () => {
    expect(navLinks(render(commissioner)).map((link) => [link.text, link.href])).toEqual([
      ["Team", "/app"],
      ["Requests", "/app/requests"],
      ["3Queue", "/commish/requests"],
      ["File", "/commish/requests/new"],
      ["Settings", "/commish/settings"],
    ]);
  });

  it("marks the current destination in both bars", () => {
    const markup = render(commissioner, "file");
    const current = [...markup.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);

    expect(current).toHaveLength(2);
    expect(current.every((tag) => tag.includes('href="/commish/requests/new"'))).toBe(true);
  });

  it("names the Queue's count for a screen reader, and shows no count at zero", () => {
    expect(render(commissioner)).toContain('aria-label="Queue, 3 need you"');
    expect(render({ ...commissioner, waiting: 0 })).not.toContain('class="badge"');
  });

  it("offers sign-out on this device from the account control", () => {
    const markup = render(manager);

    expect(markup).toContain('aria-label="Account and sign out"');
    expect(markup).toContain("dana@example.com");
    expect(markup).toContain("Team 7");
    expect(formsIn(markup).filter((form) => form.action === "/logout")).not.toHaveLength(0);
  });

  it.each([
    ["rehearsal", "Nothing here is sent to ESPN."],
    ["practice", "Swaps go to a practice copy of ESPN."],
  ] as const)("shows the %s bar", (bar, sentence) => {
    expect(render({ ...manager, bar })).toContain(sentence);
  });

  it("shows no bar where writes are real", () => {
    expect(render(manager)).not.toContain('class="rehearsal"');
  });

  it("ends with the line saying it isn't ESPN's or the NBA's", () => {
    expect(render(manager)).toContain("Not affiliated with ESPN or the NBA");
  });

  it("leaves the tab bar off a step page, keeping the top bar", () => {
    const html = renderMarkup(
      <Shell shell={manager} current="team" tabs={false}>
        <p>page</p>
      </Shell>
    );

    expect(html).not.toContain('class="tabbar');
    expect(html).toContain('class="topbar');
  });
});
