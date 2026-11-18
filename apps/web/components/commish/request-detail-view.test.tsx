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
    reversal: null,
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
      managerName: null,
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
    expect(text.indexOf("Asked 8:10 PM PT · Marcus")).toBeLessThan(
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
    ).toContain("the email provider refused it at 8:10 PM PT.");
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

type Ready = Extract<Found["instructions"], { status: "ready" }>;
const READY: Ready = {
  status: "ready",
  readAt: t,
  lineupMoves: [
    { playerId: 5144091, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" },
    { playerId: 6606, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
  ],
  lineupNoLongerFits: null,
  lineupDoneAt: null,
  confirmedMoves: null,
  heldForEarlier: null,
  adjustment: {
    matchupPeriodId: 4,
    teamName: "Stretch Fours",
    currentTenths: 0,
    deltaTenths: -310,
    enterTenths: -310,
    reason: "Injury sub: Fears for Lillard, −31.0",
    reasonTooLong: false,
  },
};
const reviewing = (reason: SubRequestRecord["reviewReason"], rest: Partial<Found> = {}) =>
  view(
    { status: "needs_review", reviewReason: reason },
    {
      actions: ["reject", "override", "complete"],
      approval: null,
      sends: null,
      instructions: READY,
      ...rest,
    }
  );

describe("CommissionerRequestView: by hand, held, changed and stale", () => {
  it("numbers the by-hand steps from ESPN as read, each value with a Copy button", () => {
    const html = render(reviewing("ambiguous"));
    const text = textOf(html);

    expect(text).toContain("By hand on ESPNFrom ESPN 8:10 PM PT");
    expect(text).toContain("Lineup, Stretch Fours,");
    expect(text).toContain("Fears BN → G");
    expect(text).toContain("Enter −31.0.");
    expect(elementsWithClass(html, "hstep")).toHaveLength(4);
    expect(elementsWithClass(html, "copyval")).toHaveLength(2);
    expect(text).toContain("Copy");
  });

  it("says ESPN couldn't be read for the steps, with a way to try again", () => {
    const html = render(
      reviewing("ambiguous", {
        instructions: { status: "unavailable", reason: "espn_unreachable", readAt: t },
      })
    );

    expect(textOf(html)).toContain("Can't read ESPN right now, so the steps can't be worked out.");
    expect(textOf(html)).toContain("Read failed 8:10 PM PT");
  });

  it("compares what re-approving posts with what's on ESPN now", () => {
    const text = textOf(
      render(
        reviewing("adjustment_held_rules", {
          actions: ["reapprove", "override", "complete"],
          approval: { action: "reapprove", computedTenths: -878, overrideTenths: null },
        })
      )
    );

    expect(text).toContain("Re-approving posts");
    expect(text).toContain("Computed−87.8From box scores");
    expect(text).toContain("Re-approve · −87.8");
    expect(text).toContain("Adjustment only, by hand");
  });

  it("shows the change that would be sent now beside the one the manager confirmed", () => {
    const text = textOf(
      render(
        reviewing("stale", {
          instructions: {
            ...READY,
            confirmedMoves: [
              { playerId: 5144091, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "F" },
            ],
          },
        })
      )
    );

    expect(text).toContain("Would be sent now");
    expect(text).toContain("Marcus saw this 8:10 PM PT");
  });

  it("opens the adjustment-only form ticked, with the adjustment it records", () => {
    const html = render(reviewing("adjustment_held_rules"), { form: "complete-adjustment" });

    expect(html).toMatch(/name="adjustmentOnly"[^>]*checked=""/);
    expect(textOf(html)).toContain("Adjustment−31.0");
  });

  it("keeps the override form open with its error", () => {
    expect(
      textOf(render(reviewing("suspension"), { form: "override", status: "invalid_form" }))
    ).toContain("Enter an amount like −18.0.");
  });

  it("gives a done request's reversal the value to set, with a Copy button", () => {
    const html = render(
      view(
        { status: "completed", finalAdjustmentTenths: -310 },
        {
          actions: ["reverse"],
          approval: null,
          sends: null,
          reversal: { currentTenths: -310, enterTenths: 0, appliedTenths: -310 },
        }
      )
    );

    expect(textOf(html)).toContain(
      "Set their adjustment to 0.0 (now −31.0), then mark it reversed."
    );
    expect(elementsWithClass(html, "copyval")).toHaveLength(1);
  });

  it("says a done request with no adjustment has nothing to take back", () => {
    const text = textOf(
      render(
        view(
          { status: "completed", finalAdjustmentTenths: 0 },
          {
            actions: ["reverse"],
            approval: null,
            sends: null,
            reversal: { currentTenths: 0, enterTenths: 0, appliedTenths: 0 },
          }
        )
      )
    );

    expect(text).toContain("It posted no adjustment, so there's nothing to take back on ESPN.");
    expect(text).not.toContain("Set their adjustment");
  });
});

// FS-DETAIL-6, -12 to -14, IF-DETAIL-7: what each form asks and the amounts beside an override.
describe("the detail's forms and amounts, in their words", () => {
  it("asks the by-hand form's first day and offers adjustment only (FS-DETAIL-12)", () => {
    const text = textOf(render(view(), { form: "complete" }));

    expect(text).toContain("active");
    expect(text).toContain("(the request's day)");
    expect(text).toContain("points off.");
    expect(text).toContain("Adjustment only: the lineup wasn't changed on ESPN");
  });

  it("asks the override's amount, with the computed one kept (FS-DETAIL-13)", () => {
    const text = textOf(render(view(), { form: "override" }));

    expect(text).toContain("Amount to apply instead");
    expect(text).toContain("Both stay on the record.");
    expect(text).toContain("Save override");
    expect(text).toContain("Cancel");
  });

  it("keeps the computed amount beside an override, and what ESPN shows (FS-DETAIL-6)", () => {
    const text = textOf(
      render(
        view(
          { status: "completed", finalAdjustmentTenths: -250 },
          {
            adjustment: { computedTenths: -310, overrideTenths: -250, appliedTenths: -250 },
            actions: ["reverse"],
            approval: null,
            sends: null,
          }
        )
      )
    );

    expect(text).toContain("Computed−31.0");
    expect(text).toContain("Your override−25.0");
    expect(text).toContain("On ESPN−25.0");
  });

  it("asks the rejection's reason the manager will see, counted to 500 (FS-DETAIL-14)", () => {
    const text = textOf(render(view(), { form: "reject" }));

    expect(text).toContain("Reason Marcus will see");
    expect(text).toContain("0 of 500");
    expect(text).toContain("Reject request");
  });
});
