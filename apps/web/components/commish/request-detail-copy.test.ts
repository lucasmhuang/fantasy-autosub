import type { SubRequestRecord } from "@injurysub/db";
import { describe, expect, it } from "vitest";
import type { RequestDetailView } from "../../lib/server/commish";
import {
  comparePanel,
  detailActions,
  detailHeader,
  detailRecord,
  detailStatus,
  emailMark,
} from "./request-detail-copy";

type Found = Extract<RequestDetailView, { status: "found" }>;

const zone = "America/Los_Angeles";
const now = new Date("2026-11-17T05:00:00.000Z");
// Mon 8:10 PM PT.
const t = new Date("2026-11-17T04:10:00.000Z");
const reading = { zone, now, ownTeam: false };

function view(request: Partial<SubRequestRecord> = {}, rest: Partial<Found> = {}): Found {
  return {
    status: "found",
    request: {
      requestId: "r1",
      kind: "substitution",
      teamId: 4,
      injuredPlayerId: 1,
      injuredName: "Domantas Sabonis",
      injuredSlot: "C",
      replacementPlayerId: 2,
      replacementName: "Jonas Valančiūnas",
      requestMoment: t,
      filedAt: t,
      status: "awaiting_approval",
      reviewReason: null,
      expiresAt: new Date("2026-11-17T16:10:00.000Z"),
      matchupPeriodId: 4,
      projectedAdjustmentTenths: -310,
      finalAdjustmentTenths: null,
      overrideAdjustmentTenths: null,
      version: 2,
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
    reversal: null,
    sends: null,
    ...rest,
  };
}

describe("detailHeader", () => {
  it("names the team, the swap in full with its slot, and who asked when", () => {
    expect(detailHeader(view(), reading)).toEqual({
      team: "Stretch Fours",
      swap: "Jonas Valančiūnas in for Domantas Sabonis · C slot",
      asked: "Asked Mon 8:10 PM PT · Marcus",
    });
  });

  it("says you asked on your own team, and who you filed for", () => {
    expect(detailHeader(view(), { ...reading, ownTeam: true }).asked).toBe(
      "Asked Mon 8:10 PM PT · you"
    );
    expect(detailHeader(view({ kind: "on_behalf" }), reading).asked).toBe(
      "Filed by you for Marcus"
    );
    expect(
      detailHeader(view({ teamId: 9 }, { names: { team: null, manager: null } }), reading)
    ).toMatchObject({
      team: "Team 9",
      asked: "Asked Mon 8:10 PM PT",
    });
  });
});

describe("detailStatus", () => {
  it("says what approving does and when it expires", () => {
    expect(detailStatus(view(), reading)).toEqual({
      tone: "wait",
      word: "Needs you: approval",
      who: "",
      sentence:
        "Approving re-checks ESPN, then makes the swap and posts −31.0. If it isn't approved by Tue 8:10 AM PT, it's marked expired and stays in Needs you, where you can still approve it or settle it by hand.",
    });
  });

  it("says your own team's approval shows as a self-approval", () => {
    expect(detailStatus(view(), { ...reading, ownTeam: true }).sentence).toBe(
      "Your own team's request. Approving it shows as a self-approval in its record and your team's history."
    );
  });

  it("names a review's reason once, with the queue's sentence", () => {
    expect(
      detailStatus(view({ status: "needs_review", reviewReason: "suspension" }), reading)
    ).toEqual({
      tone: "wait",
      word: "Needs you: suspension",
      who: "",
      sentence: "Sabonis is suspended, not OUT.",
    });
    expect(
      detailStatus(view({ status: "needs_review", reviewReason: "ambiguous" }), reading).word
    ).toBe("Needs you: check ESPN");
  });

  it("offers nothing while it runs, and says when ESPN's access holds it up", () => {
    expect(detailStatus(view({ status: "executing" }), reading)).toEqual({
      tone: "busy",
      word: "In progress",
      who: "InjurySub acts next",
      sentence: "Actions come back if it stops.",
    });
    expect(
      detailStatus(
        view({ status: "queued" }, { blocked: "credentials_rejected", blockedSince: t }),
        reading
      )
    ).toEqual({
      tone: "busy",
      word: "In line · blocked",
      who: "You renew the ESPN cookie",
      sentence:
        'ESPN refused InjurySub\'s access at Mon 8:10 PM PT, so nothing was sent. Marcus sees "delayed". It re-checks ESPN before sending once access is back.',
    });
  });

  it("says where a settled request stands", () => {
    const done = view(
      { status: "completed", finalAdjustmentTenths: -878 },
      { events: [{ eventType: "completed", actorType: "system", createdAt: t, payload: {} }] }
    );
    expect(detailStatus(done, reading)).toEqual({
      tone: "ok",
      word: "Done",
      who: "On ESPN Mon 8:10 PM PT",
      sentence: "Valančiūnas at C; −87.8 on Stretch Fours, week 4.",
    });
    expect(detailStatus(view({ status: "rejected" }), reading)).toMatchObject({
      tone: "neutral",
      word: "Rejected",
      sentence: "Marcus sees your reason.",
    });
    expect(detailStatus(view({ status: "withdrawn" }), reading).sentence).toBe(
      "Marcus withdrew it; nothing was sent."
    );
  });
});

describe("detailActions", () => {
  it("makes approval the one button, with the rest as text buttons and Reject last", () => {
    expect(detailActions(view(), reading)).toEqual({
      primary: { kind: "approve", label: "Approve and run · −31.0", shownTenths: -310 },
      links: [
        { form: "override", label: "Override amount" },
        { form: "complete", label: "Settle by hand" },
        { form: "reject", label: "Reject" },
      ],
    });
  });

  it("names an approval of your own team's request, and a re-approval", () => {
    expect(detailActions(view(), { ...reading, ownTeam: true }).primary).toMatchObject({
      label: "Approve your own request · −31.0",
    });
    expect(
      detailActions(
        view(
          { status: "needs_review", reviewReason: "adjustment_changed" },
          {
            actions: ["reapprove", "override", "complete"],
            approval: { action: "reapprove", computedTenths: -878, overrideTenths: null },
          }
        ),
        reading
      )
    ).toEqual({
      primary: { kind: "reapprove", label: "Re-approve · −87.8", shownTenths: -878 },
      links: [
        { form: "complete-adjustment", label: "Adjustment only, by hand" },
        { form: "override", label: "Override amount" },
      ],
    });
  });

  it("leads with settling by hand when nothing can be approved, and offers none while it runs", () => {
    expect(
      detailActions(
        view({}, { actions: ["reject", "override", "complete"], approval: null }),
        reading
      )
    ).toEqual({
      primary: { kind: "form", form: "complete", label: "Mark done by hand" },
      links: [
        { form: "override", label: "Override amount" },
        { form: "reject", label: "Reject" },
      ],
    });
    expect(
      detailActions(view({ status: "executing" }, { actions: [], approval: null }), reading)
    ).toEqual({
      primary: null,
      links: [],
    });
  });
});

describe("emailMark", () => {
  it("says the email provider refused the alert, or only that it didn't go out", () => {
    expect(emailMark({ state: "failed", at: t, code: "send_rejected" }, reading)).toBe(
      "The alert email for this request didn't go out: the email provider refused it at Mon 8:10 PM PT."
    );
    expect(emailMark({ state: "failed", at: t, code: "send_unavailable" }, reading)).toBe(
      "The alert email for this request didn't go out at Mon 8:10 PM PT."
    );
    expect(emailMark({ state: "sent", at: t }, reading)).toBeNull();
  });
});

describe("detailRecord", () => {
  it("lists every event with its time in your words, and each ESPN snapshot taken", () => {
    const records = detailRecord(
      view(
        {},
        {
          events: [
            { eventType: "request_filed", actorType: "manager", createdAt: t, payload: {} },
            { eventType: "sent_to_review", actorType: "system", createdAt: t, payload: {} },
            { eventType: "approved", actorType: "commissioner", createdAt: t, payload: {} },
            { eventType: "requeued", actorType: "system", createdAt: t, payload: {} },
          ],
          snapshots: [{ phase: "request", espnDay: 8, takenAt: t }],
        }
      ),
      reading
    );
    expect(records.map(({ text }) => text)).toEqual([
      "Marcus asked: Valančiūnas in for Sabonis",
      "ESPN snapshot taken at filing",
      "Sent to you",
      "You approved",
      "Back in line",
    ]);
    expect(records[0]?.time).toBe("Mon 8:10 PM PT");
  });

  // IF-DETAIL-4.
  it("marks your approval of your own team's request as a self-approval", () => {
    const records = detailRecord(
      view(
        {},
        {
          events: [
            {
              eventType: "approved",
              actorType: "commissioner",
              createdAt: t,
              payload: { selfApproval: true },
            },
          ],
          snapshots: [],
        }
      ),
      reading
    );
    expect(records.map(({ text }) => text)).toEqual(["You approved (self-approval)"]);
  });
});

const review = (reviewReason: SubRequestRecord["reviewReason"], rest: Partial<Found> = {}) =>
  view({ status: "needs_review", reviewReason }, rest);
const FACTS = {
  reviewedAt: t,
  otherMoves: [],
  sentTenths: null,
  approvedTenths: -821,
  heldTenths: -878,
  mismatches: [{ kind: "setting" as const, setting: "Steals points", expected: "3", espn: "2" }],
};

describe("held, changed, stale and check-ESPN requests", () => {
  it("names the rule that held the adjustment, and what fixing it means", () => {
    expect(detailStatus(review("adjustment_held_rules", { facts: FACTS }), reading).sentence).toBe(
      "Lineup done. Steals points is 2 on ESPN; InjurySub expects 3. Fix it on ESPN and re-approve, or post the adjustment by hand."
    );
  });

  it("gives both amounts when the amount changed after approval", () => {
    expect(detailStatus(review("adjustment_changed", { facts: FACTS }), reading).sentence).toBe(
      "The amount changed from −82.1 to −87.8 after you approved."
    );
  });

  it("says a changed lineup sends what fits now, and a check ESPN posted nothing", () => {
    expect(detailStatus(review("stale"), reading).sentence).toBe(
      "Marcus's lineup changed on ESPN after the request; nothing was sent. Approving re-checks and sends the change below if it still moves at most one other starter."
    );
    expect(detailStatus(review("ambiguous"), reading).sentence).toBe(
      "ESPN's lineup didn't match after the change. No adjustment was posted."
    );
  });

  it("compares what re-approving posts with what's on ESPN now", () => {
    const held = review("adjustment_held_rules", {
      facts: FACTS,
      instructions: {
        status: "ready",
        readAt: t,
        lineupMoves: [],
        lineupNoLongerFits: null,
        lineupDoneAt: t,
        confirmedMoves: null,
        heldForEarlier: null,
        adjustment: {
          matchupPeriodId: 4,
          teamName: "Stretch Fours",
          currentTenths: 0,
          deltaTenths: -878,
          enterTenths: -878,
          reason: "x",
          reasonTooLong: false,
        },
      },
    });
    expect(comparePanel(held, reading)).toEqual({
      title: "Re-approving posts",
      left: { k: "Computed", v: "−87.8", s: "From box scores" },
      right: { k: "On ESPN now", v: "0.0", s: "Stretch Fours, week 4" },
    });
  });

  it("compares the amount approved with the amount now", () => {
    const changed = review("adjustment_changed", {
      facts: FACTS,
      events: [{ eventType: "approved", actorType: "commissioner", createdAt: t, payload: {} }],
    });
    expect(comparePanel(changed, reading)).toEqual({
      title: "Both amounts",
      left: { k: "When you approved", v: "−82.1", s: "Mon 8:10 PM PT" },
      right: { k: "Now", v: "−87.8", s: "" },
    });
    expect(comparePanel(review("suspension"), reading)).toBeNull();
  });

  it("offers a held or changed amount's re-approval, then adjustment only by hand, then override", () => {
    const actions = detailActions(
      review("adjustment_held_rules", {
        actions: ["reapprove", "override", "complete"],
        approval: { action: "reapprove", computedTenths: -878, overrideTenths: null },
      }),
      reading
    );
    expect(actions.links).toEqual([
      { form: "complete-adjustment", label: "Adjustment only, by hand" },
      { form: "override", label: "Override amount" },
    ]);
  });

  it("leads a held amount with posting the adjustment by hand when it can't be re-approved", () => {
    expect(
      detailActions(
        review("adjustment_held_rules", { actions: ["override", "complete"], approval: null }),
        reading
      )
    ).toEqual({
      primary: { kind: "form", form: "complete-adjustment", label: "Adjustment only, by hand" },
      links: [{ form: "override", label: "Override amount" }],
    });
  });
});
