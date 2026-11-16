import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../../lib/server/request-view";
import { elementsWithClass, linksIn, renderMarkup, textOf } from "../test-support";
import { RequestsListView } from "./requests-list-view";

const NOW = new Date("2026-10-28T02:00:00.000Z");

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  requestId: "6f1b2a3c-0000-4000-8000-000000000001",
  status: "completed",
  injuredPlayerId: 6606,
  injuredName: "Damian Lillard",
  replacementPlayerId: 5144091,
  replacementName: "Jeremiah Fears",
  filedAt: new Date("2026-10-28T01:41:00.000Z"),
  matchupPeriodId: 2,
  amountTenths: -126,
  ...overrides,
});

const render = (history: Parameters<typeof RequestsListView>[0]["history"]) =>
  renderMarkup(
    <RequestsListView
      history={history}
      team="Team 1"
      zone="America/Los_Angeles"
      now={NOW}
      commissionerName="Sam Lee"
    />
  ).replaceAll("<!-- -->", "");

describe("RequestsListView", () => {
  it("heads the list with the team, then a row per request", () => {
    const html = render({ status: "found", requests: [entry(), entry({ amountTenths: null })] });

    expect(textOf(html)).toContain("Your requestsTeam 1");
    expect(elementsWithClass(html, "reqrow").length).toBe(2);
    expect(textOf(html)).toContain("Fears in for Lillard−12.6Done");
    expect(textOf(html)).toContain("· week 2");
    expect(textOf(html)).toContain("Fears in for Lillard—Done");
  });

  // FM-LIST-1.
  it("says the list couldn't load, with a way to try again", () => {
    const html = render({ status: "unavailable" });

    expect(textOf(html)).toContain("Couldn't load your requests. Try again in a moment.");
    expect(linksIn(html)).toContainEqual({ href: "/app/requests", text: "Try again" });
  });
});
