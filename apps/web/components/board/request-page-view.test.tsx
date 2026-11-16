import { describe, expect, it } from "vitest";
import type { RequestView, TrackerTimes } from "../../lib/server/request-view";
import { elementsWithClass, formsIn, linksIn, renderMarkup, textOf } from "../test-support";
import { RequestPageView } from "./request-page-view";

type Found = Extract<RequestView, { status: "found" }>;

const PT = "America/Los_Angeles";
const NOW = new Date("2026-10-28T02:00:00.000Z");
const ASKED = new Date("2026-10-28T01:41:00.000Z");
const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 1, minute));
const NO_TIMES: TrackerTimes = {
  checkedAt: null,
  lineupSentAt: null,
  lineupVerifiedAt: null,
  adjustmentSentAt: null,
  adjustmentVerifiedAt: null,
  completedAt: null,
};

const view = (request: Partial<Found["request"]> = {}, fields: Partial<Found> = {}): Found => ({
  status: "found",
  request: {
    requestId: "44444444-4444-4444-8444-444444444444",
    status: "queued",
    reviewReason: null,
    refusalReason: null,
    injuredPlayerId: 6606,
    injuredName: "Damian Lillard",
    injuredSlot: "G",
    replacementPlayerId: 5144091,
    replacementName: "Jeremiah Fears",
    filedAt: ASKED,
    requestMoment: ASKED,
    requestDay: 8,
    matchupPeriodId: 2,
    adjustmentTenths: -465,
    adjustmentIsFinal: false,
    effectiveDay: null,
    rehearsal: false,
    ...request,
  },
  breakdown: [
    { day: 7, name: "Damian Lillard", tenths: -465, why: "injured_credited_before_swap" },
  ],
  commissionerReason: null,
  canWithdraw: true,
  delayed: false,
  notStarted: false,
  adjustmentNotSent: false,
  sentEdit: null,
  tracker: NO_TIMES,
  ahead: null,
  alertEmail: { state: "unknown" },
  events: [
    { at: ASKED, type: "request_filed", actor: "manager" },
    { at: at(41), type: "preflight_passed", actor: "system" },
  ],
  refusal: null,
  ...fields,
});

const render = (found: Found, zone = PT) =>
  renderMarkup(<RequestPageView view={found} zone={zone} now={NOW} commissionerName="Sam Lee" />)
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");

describe("RequestPageView", () => {
  it("heads the page with the swap, when it was asked, the slot and the week", () => {
    expect(textOf(render(view()))).toContain(
      "Fears in for LillardAsked Tue 6:41 PM PT · G slot · week 2"
    );
  });

  it("shows the card stage and the tracker while it's in line or running", () => {
    const html = render(
      view(
        { status: "executing" },
        { canWithdraw: false, tracker: { ...NO_TIMES, checkedAt: at(41), lineupSentAt: at(41) } }
      )
    );

    expect(elementsWithClass(html, "stage").length).toBe(1);
    expect(textOf(html)).toContain("In progressInjurySub acts next");
    expect(textOf(html)).toContain("Lineupsent 6:41 PM PT");
    expect(textOf(html)).toContain("Too late to withdraw.");
  });

  // IF-MOTION-1 to -3: the swap plays once, on arrival from Confirm.
  it("marks the page to play the swap on arrival from Confirm, on the stage or in the rows", () => {
    const arriving = (status: Found["request"]["status"]) =>
      renderMarkup(
        <RequestPageView
          view={view({ status })}
          zone={PT}
          now={NOW}
          commissionerName="Sam Lee"
          arrived
        />
      );

    expect(arriving("queued")).toContain('data-arrival="stage"');
    expect(arriving("awaiting_approval")).toContain('data-arrival="rows"');
    expect(render(view({ status: "queued" }))).not.toContain("data-arrival");
  });

  // IF-REQUEST-8: the page that watched it run keeps its live region, so Done is read out.
  it("keeps the status announced once settled on a page that watched it change", () => {
    const watched = renderMarkup(
      <RequestPageView
        view={view({ status: "completed" })}
        zone={PT}
        now={NOW}
        commissionerName="Sam Lee"
        announce
      />
    );

    expect(watched).toContain('aria-live="polite"');
    expect(render(view({ status: "completed" }))).not.toContain('aria-live="polite"');
  });

  it("cues the sheen at Done, never on a rehearsal", () => {
    const done = render(view({ status: "completed" }));
    const rehearsal = render(view({ status: "completed", rehearsal: true }));

    expect(elementsWithClass(done, "sheen")).toHaveLength(1);
    expect(elementsWithClass(done, "sheen", "play")).toEqual([]);
    expect(elementsWithClass(rehearsal, "sheen")).toEqual([]);
  });

  it("shows two lines instead of the stage while it waits, with withdraw asked to be sure", () => {
    const html = render(view({ status: "awaiting_approval" }));

    expect(elementsWithClass(html, "stage")).toEqual([]);
    expect(textOf(html)).toContain("Will come off the bench.");
    expect(textOf(html)).toContain("Withdraw this request?");
    expect(formsIn(html)).toContainEqual(
      expect.objectContaining({
        action: "/requests/44444444-4444-4444-8444-444444444444/withdraw",
        method: "post",
      })
    );
  });

  it("says what ESPN shows once done, the foil lit, the amount final", () => {
    const html = render(
      view(
        { status: "completed", adjustmentIsFinal: true },
        {
          canWithdraw: false,
          tracker: {
            ...NO_TIMES,
            checkedAt: at(41),
            lineupVerifiedAt: at(41),
            adjustmentVerifiedAt: at(42),
            completedAt: at(42),
          },
        }
      )
    );

    expect(textOf(html)).toContain("DoneOn ESPN Tue 6:42 PM PT");
    expect(textOf(html)).toContain("What ESPN shows now");
    expect(textOf(html)).toContain("Fears at G, Lillard on the bench");
    expect(textOf(html)).toContain("Final");
    expect(elementsWithClass(html, "foil", "is-unlit")).toEqual([]);
  });

  it("never says Done on a rehearsal, showing what it would have sent", () => {
    const text = textOf(
      render(view({ status: "completed", rehearsal: true }, { canWithdraw: false }))
    );

    expect(text).toContain("Rehearsal");
    expect(text).toContain("Would have sent");
    expect(text).not.toContain("DoneOn ESPN");
  });

  // FS-REQUEST-15: the reversal cancels the adjustment with one final line, and the record says
  // by how much.
  it("shows a reversal as one final line cancelling the adjustment", () => {
    const html = render(
      view(
        { status: "reversed", adjustmentTenths: -465, adjustmentIsFinal: true },
        {
          canWithdraw: false,
          events: [
            { at: ASKED, type: "request_filed", actor: "manager" },
            { at: at(55), type: "reversed", actor: "commissioner" },
          ],
        }
      )
    );
    const adjustment = textOf(html).slice(textOf(html).indexOf("AdjustmentFinal"));

    expect(adjustment).toContain(
      "AdjustmentFinal+46.5Reversal · Tue Oct 27+46.5Cancels the −46.5 adjustment"
    );
    expect(textOf(html)).not.toContain("Forfeited while starting");
    expect(textOf(html)).toContain("Sam reversed it: +46.5");
  });

  // IF-CONFIRM-7: Confirm refused lands here, kept in the history.
  it("offers the way back to Team, and the starter's standing request, once refused", () => {
    const standing = "55555555-5555-4555-8555-555555555555";
    const refused = view(
      { status: "refused", refusalReason: "active_request_exists" },
      {
        canWithdraw: false,
        refusal: {
          designation: "OUT",
          replacementSlot: null,
          activeRequest: { requestId: standing, title: "Edey in for Lillard", status: "queued" },
        },
      }
    );
    const fromConfirm = renderMarkup(
      <RequestPageView view={refused} zone={PT} now={NOW} commissionerName="Sam Lee" fromConfirm />
    );
    const later = render(refused);

    expect(linksIn(fromConfirm)).toEqual(
      expect.arrayContaining([
        { href: "/app/requests/new?injured=6606", text: "Replacements" },
        { href: `/app/requests/${standing}`, text: "See that request" },
        { href: "/app", text: "Back to Team" },
      ])
    );
    expect(linksIn(later)).toContainEqual({ href: "/app/requests", text: "Requests" });
    expect(linksIn(later)).toContainEqual({
      href: `/app/requests/${standing}`,
      text: "See that request",
    });
    expect(textOf(later)).not.toContain("Adjustment");
  });

  it("shows no adjustment for a rejected request, with the commissioner's reason", () => {
    const text = textOf(
      render(view({ status: "rejected" }, { canWithdraw: false, commissionerReason: "He played." }))
    );

    expect(text).toContain('Sam declined it: "He played."');
    expect(text).not.toContain("Adjustment");
  });

  it("dates the adjustment's lines by ESPN's day, and keeps the record behind a disclosure", () => {
    const html = render(view());

    expect(textOf(html)).toContain("Lillard · Mon Oct 26");
    expect(textOf(html)).toContain("Full record");
    expect(html).toContain("<details");
  });

  it("names the ESPN day a request counts for when asked after midnight east of Pacific", () => {
    const lateEast = view({ requestMoment: new Date("2026-10-28T05:10:00.000Z") });

    expect(textOf(render(lateEast, "America/New_York"))).toContain("counts for Tue Oct 27");
  });
});
