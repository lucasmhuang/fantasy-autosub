import { describe, expect, it } from "vitest";
import type { Queue, QueueAlert, QueueHealth, QueueRequest } from "../../lib/server/queue";
import { elementsWithClass, formsIn, linksIn, renderMarkup, textOf } from "../test-support";
import { QueueView } from "./queue-view";

const NOW = new Date("2026-11-17T05:00:00.000Z");
const t = new Date("2026-11-17T04:10:00.000Z");

const HEALTH: QueueHealth = {
  espn: { state: "working", since: t, checkedAt: t },
  blockedCount: 0,
  worker: { lastBeatAt: t, down: false },
  rules: { mismatches: [], checkedAt: t, lastMatchedAt: t },
  watch: { state: "watching", checkedAt: t },
};

const request = (overrides: Partial<QueueRequest> = {}): QueueRequest => ({
  kind: "request",
  requestId: "6f1b2a3c-0000-4000-8000-000000000001",
  teamId: 4,
  teamName: "Stretch Fours",
  managerName: null,
  injured: { playerId: 6606, name: "Damian Lillard" },
  replacement: { playerId: 5144091, name: "Jeremiah Fears" },
  status: "needs_review",
  reviewReason: "automation_off",
  filedAt: t,
  expiresAt: null,
  matchupPeriodId: 4,
  amountTenths: -226,
  amountFinal: false,
  facts: null,
  ...overrides,
});

const alert: QueueAlert = {
  kind: "alert",
  alertId: "a1",
  alertKind: "lm_transaction",
  teamId: 2,
  teamName: "Backdoor Cutters",
  at: t,
};

function found(overrides: Partial<Extract<Queue, { status: "found" }>> = {}): Queue {
  return {
    status: "found",
    health: HEALTH,
    automation: { status: "on", mode: "approval_required", teamCount: 12, changedAt: null },
    needsYou: [request(), alert],
    rest: [
      request({ requestId: "done", status: "completed", reviewReason: null, amountFinal: true }),
    ],
    ...overrides,
  };
}

const render = (queue: Queue, status?: string) =>
  renderMarkup(<QueueView queue={queue} status={status} zone="America/Los_Angeles" now={NOW} />)
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");

describe("QueueView", () => {
  it("opens with the automation strip and health, then Needs you, then everything else", () => {
    const html = render(found());
    const text = textOf(html);

    expect(text.indexOf("Automation on")).toBeLessThan(text.indexOf("Health"));
    expect(text.indexOf("Health")).toBeLessThan(text.indexOf("Needs you · 2"));
    expect(text.indexOf("Needs you · 2")).toBeLessThan(text.indexOf("Everything else"));
    expect(formsIn(html).map(({ action }) => action)).toEqual(["/commish/automation/off"]);
  });

  it("links each request to its detail and each alert to the misuse watch page", () => {
    const hrefs = linksIn(render(found())).map(({ href }) => href);

    expect(hrefs).toEqual([
      "/commish/alerts",
      "/commish/requests/6f1b2a3c-0000-4000-8000-000000000001",
      "/commish/alerts",
      "/commish/requests/done",
    ]);
    expect(elementsWithClass(render(found()), "queue-alert-mark")).toHaveLength(1);
  });

  it("says nothing needs the commissioner, and leaves out an empty everything else", () => {
    const text = textOf(render(found({ needsYou: [], rest: [] })));

    expect(text).toContain("Needs youNothing needs you.");
    expect(text).not.toContain("Everything else");
  });

  it("says the queue couldn't load, never an empty queue, with a way to try again", () => {
    const html = render({ status: "unavailable" });

    expect(textOf(html)).toBe(
      "QueueAutomation · can't be read right nowCouldn't load the queue: InjurySub's database didn't answer. This isn't an empty queue.Try again"
    );
    expect(linksIn(html)).toEqual([{ href: "/commish/requests", text: "Try again" }]);
  });

  it("says when automation was turned off, under a strip whose switch turns it back on", () => {
    const html = render(
      found({ automation: { status: "switched_off", mode: "auto", teamCount: 3, changedAt: t } })
    );

    expect(textOf(html)).toContain(
      "Automation off · every request goes to Needs youTurned off 8:10 PM PT. Requests in line stop before anything is sent and go to Needs you."
    );
    expect(formsIn(html).map(({ action }) => action)).toEqual(["/commish/automation/on"]);
  });

  it("shows the answer an action left in the address", () => {
    expect(textOf(render(found(), "rejected"))).toContain(
      "Rejected. The manager sees your reason."
    );
  });
});
