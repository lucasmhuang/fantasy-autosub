import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import TeamLoading from "../../app/(app)/app/loading";
import RequestsLoading from "../../app/(app)/app/requests/(list)/loading";
import RequestLoading from "../../app/(app)/app/requests/[id]/loading";
import ChooseLoading from "../../app/(app)/app/requests/new/loading";
import QueueLoading from "../../app/(commish)/commish/requests/(queue)/loading";
import DetailLoading from "../../app/(commish)/commish/requests/[id]/loading";
import FilingLoading from "../../app/(commish)/commish/requests/new/loading";
import { elementsWithClass, renderMarkup } from "../test-support";

type Case = {
  page: string;
  Loading: ComponentType;
  // The tab marked current, and how many tabs every viewer of the page has; none on a step page.
  current: string | null;
  tabs: number;
  // The class of the page's own head, which sits where the loaded page puts it.
  head: string;
};

const CASES: Case[] = [
  { page: "the team page", Loading: TeamLoading, current: "/app", tabs: 2, head: "pagehead" },
  {
    page: "the requests list",
    Loading: RequestsLoading,
    current: "/app/requests",
    tabs: 2,
    head: "titleblock",
  },
  { page: "Choose", Loading: ChooseLoading, current: null, tabs: 0, head: "choosehead" },
  {
    page: "a request's page",
    Loading: RequestLoading,
    current: "/app/requests",
    tabs: 2,
    head: "reqhead",
  },
  {
    page: "the queue",
    Loading: QueueLoading,
    current: "/commish/requests",
    tabs: 5,
    head: "titleblock",
  },
  {
    page: "filing for a manager",
    Loading: FilingLoading,
    current: "/commish/requests/new",
    tabs: 5,
    head: "titleblock",
  },
  {
    page: "a request's detail",
    Loading: DetailLoading,
    current: "/commish/requests",
    tabs: 5,
    // Its header's swap line: at 1280 the queue's own title block sits beside it.
    head: "swapline",
  },
];

// IF-LOAD-1: while a page loads, the frame is already where the loaded page puts it, so nothing
// above the content moves when the data lands.
describe("every loading state", () => {
  it.each(CASES)("draws the frame around $page's placeholders", (each) => {
    const html = renderMarkup(<each.Loading />);

    expect(elementsWithClass(html, "topbar")).toHaveLength(1);
    // The name with its mark, in the top bar and on the phone's top row (FS-SHELL-11).
    expect(elementsWithClass(html, "wordmark")).toHaveLength(2);
    expect(elementsWithClass(html, "brand-mark")).toHaveLength(2);
    expect(elementsWithClass(html, "shell-account", "phone-only")).toHaveLength(1);
    // The account control's place, in the top bar and on the phone's top row, with nothing to open.
    const accounts = elementsWithClass(html, "acct");
    expect(accounts).toHaveLength(2);
    expect(accounts.every((account) => account.attributes["aria-hidden"] === "true")).toBe(true);
    // Its placeholders wait, then fade in (IF-MOTION-10).
    expect(elementsWithClass(html, "shell-main", "is-loading")).toHaveLength(1);
    expect(elementsWithClass(html, "foot-note")).toHaveLength(1);

    const tabs = elementsWithClass(html, "tab");
    expect(tabs).toHaveLength(each.tabs);
    const marked = tabs.filter((tab) => tab.attributes["aria-current"] === "page");
    expect(marked.map((tab) => tab.attributes.href)).toEqual(
      each.current === null ? [] : [each.current]
    );

    expect(elementsWithClass(html, each.head)).toHaveLength(1);
  });
});
