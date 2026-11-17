import type { SubRequestRecord } from "@injurysub/db";
import { describe, expect, it } from "vitest";
import type { RequestDetailView } from "../../lib/server/commish";
import type { Queue } from "../../lib/server/queue";
import { elementsWithClass, formsIn, linksIn, renderMarkup, textOf } from "../test-support";
import { CommissionerRequestView } from "./request-detail-view";

type Found = Extract<RequestDetailView, { status: "found" }>;

const NOW = new Date("2026-11-17T05:00:00.000Z");
const t = new Date("2026-11-17T04:10:00.000Z");
const ID = "6f1b2a3c-0000-4000-8000-000000000001";

function view(request: Partial<SubRequestRecord> = {}, rest: Partial<Found> = {}): Found {
  return {
    status: "found",
    request: {
      requestId: ID,
      kind: "substitution",
      teamId: 4,
      injuredPlayerId: 6606,
      injuredName: "Damian Lillard",
      injuredSlot: "G",
      replacementPlayerId: 5144091,
      replacementName: "Jeremiah Fears",
      requestMoment: t,
      filedAt: t,
      requestDay: 8,
      status: "awaiting_approval",
      reviewReason: null,
      expiresAt: null,
      matchupPeriodId: 4,
      projectedAdjustmentTenths: -310,
      finalAdjustmentTenths: null,
      overrideAdjustmentTenths: null,
      version: 3,
      ...request,
    } as SubRequestRecord,
    why: null,
    blocked: null,
    blockedSince: null,
    facts: null,
    actions: ["approve", "reject", "override", "complete"],
    approval: { action: "approve", computedTenths: -310, overrideTenths: null },
    breakdown: [],
    events: [],
    snapshots: [],
    instructions: { status: "not_needed" },
    adjustment: { computedTenths: -310, overrideTenths: null, appliedTenths: null },
    filing: null,
    names: { team: "Stretch Fours", manager: "Marcus Invented" },
    alertEmail: { state: "unknown" },
    sends: {
      moves: [
        { playerId: 5144091, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" },
        { playerId: 6606, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
      ],
      amountTenths: -310,
      sideBeforeTenths: 0,
      sideAfterTenths: -310,
    },
    ...rest,
  };
}

const QUEUE: Queue = {
  status: "found",
  health: {
    espn: { state: "working", since: t, checkedAt: t },
    blockedCount: 0,
    worker: { lastBeatAt: t, down: false },
    rules: { mismatches: [], checkedAt: t, lastMatchedAt: t },
    watch: { state: "watching", checkedAt: t },
  },
  automation: { status: "on", mode: "approval_required", teamCount: 12, changedAt: null },
  needsYou: [
    {
      kind: "request",
      requestId: ID,
      teamId: 4,
      teamName: "Stretch Fours",
      injured: { playerId: 6606, name: "Damian Lillard" },
      replacement: { playerId: 5144091, name: "Jeremiah Fears" },
      status: "awaiting_approval",
      reviewReason: null,
      filedAt: t,
      expiresAt: null,
      matchupPeriodId: 4,
      amountTenths: -310,
      amountFinal: false,
      facts: null,
    },
  ],
  rest: [],
};

const render = (
  detail: Found | { status: "unavailable" },
  options: { form?: string; status?: string; ownTeam?: boolean } = {}
) =>
  renderMarkup(
    <CommissionerRequestView
      detail={detail}
      queue={QUEUE}
      form={options.form}
      status={options.status}
      ownTeam={options.ownTeam ?? false}
      zone="America/Los_Angeles"
      now={NOW}
    />
  )
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");

const detailForms = (html: string) =>
  formsIn(html).filter(({ action }) => action?.startsWith("/commish/requests/"));

describe("CommissionerRequestView", () => {
  it("reads header, status, what approving sends, then the one primary action", () => {
    const text = textOf(render(view()));

    expect(text.indexOf("Jeremiah Fears in for Damian Lillard · G slot")).toBeGreaterThan(-1);
    expect(text.indexOf("Asked Mon 8:10 PM PT · Marcus")).toBeLessThan(
      text.indexOf("Needs you: approval")
    );
    expect(text.indexOf("Needs you: approval")).toBeLessThan(text.indexOf("Approving sends"));
    expect(text).toContain("−31.0 for Stretch Fours, week 4");
    expect(text).toContain("Their side goes from 0.0 to −31.0.");
    expect(text.indexOf("Approving sends")).toBeLessThan(text.indexOf("Approve and run · −31.0"));
  });

  it("posts the approval at the version and amount shown, and offers the rest as text buttons", () => {
    const html = render(view());

    expect(detailForms(html)).toEqual([
      {
        action: `/commish/requests/${ID}/approve`,
        method: "post",
        fields: [
          { tag: "input", name: "version", type: "hidden", value: "3" },
          { tag: "input", name: "shownTenths", type: "hidden", value: "-310" },
        ],
      },
    ]);
    expect(
      linksIn(html)
        .filter(({ href }) => href?.includes("form="))
        .map(({ href, text }) => [href, text])
    ).toEqual([
      ["?form=override", "Override amount"],
      ["?form=complete", "Settle by hand"],
      ["?form=reject", "Reject"],
    ]);
  });

  it("offers no action while InjurySub runs it", () => {
    const html = render(
      view({ status: "executing" }, { actions: [], approval: null, sends: null })
    );

    expect(detailForms(html)).toEqual([]);
    expect(textOf(html)).toContain("In progressInjurySub acts nextActions come back if it stops.");
  });

  it("opens the reject form, and brings it back with the error when no reason was given", () => {
    const html = render(view(), { form: "reject", status: "invalid_form" });

    expect(detailForms(html).map(({ action }) => action)).toContain(
      `/commish/requests/${ID}/reject`
    );
    expect(textOf(html)).toContain("Add a reason; Marcus sees it on the request.");
    expect(elementsWithClass(html, "field-error")).toHaveLength(1);
  });

  it("opens the override and by-hand forms against the existing routes", () => {
    const override = detailForms(render(view(), { form: "override" }));
    const complete = detailForms(render(view(), { form: "complete" }));

    expect(override.find(({ action }) => action?.endsWith("/override"))?.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "amount" })])
    );
    expect(
      complete.find(({ action }) => action?.endsWith("/complete"))?.fields.map(({ name }) => name)
    ).toEqual(expect.arrayContaining(["version", "effectiveDay", "adjustmentOnly"]));
  });

  it("offers a done request's reversal", () => {
    const html = render(
      view(
        { status: "completed", finalAdjustmentTenths: -310 },
        { actions: ["reverse"], approval: null, sends: null }
      )
    );

    expect(detailForms(html).map(({ action }) => action)).toEqual([
      `/commish/requests/${ID}/reverse`,
    ]);
    expect(textOf(html)).toContain("Mark reversed");
  });

  it("shows what was attested on a request filed on a manager's behalf", () => {
    const text = textOf(
      render(
        view(
          { kind: "on_behalf" },
          {
            filing: {
              statedMoment: t,
              filedAt: t,
              designation: "OUT",
              designationAtFiling: "OUT",
              replacementGame: "in_progress",
              enteredTenths: 57,
              note: "Texted with a screenshot.",
              attestedFields: ["designation", "replacementGame"],
            },
          }
        )
      )
    );

    expect(text).toContain("Filed for Marcus");
    expect(text).toContain("Lillard thenOUT · attested");
    expect(text).toContain("Fears's points before5.7 · entered by hand");
    expect(text).toContain("Texted with a screenshot.");
  });

  it("marks an alert email that didn't go out", () => {
    expect(
      textOf(render(view({}, { alertEmail: { state: "failed", at: t, code: "send_rejected" } })))
    ).toContain("the email provider refused it at Mon 8:10 PM PT.");
  });

  it("puts the queue beside the detail, with this request's row marked", () => {
    const html = render(view());

    expect(elementsWithClass(html, "col", "desk-only")).toHaveLength(1);
    expect(elementsWithClass(html, "qrow")[0]?.attributes["aria-current"]).toBe("true");
    expect(linksIn(html).find(({ text }) => text.includes("Queue"))?.href).toBe(
      "/commish/requests"
    );
  });

  it("says the request can't be shown when its record couldn't be read", () => {
    expect(textOf(render({ status: "unavailable" }))).toContain(
      "Couldn't load this request: InjurySub's database didn't answer."
    );
  });
});
