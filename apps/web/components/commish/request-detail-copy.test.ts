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
// 8:10 PM PT.
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
      asked: "Asked 8:10 PM PT · Marcus",
    });
  });

  it("says you asked on your own team, and who you filed for", () => {
    expect(detailHeader(view(), { ...reading, ownTeam: true }).asked).toBe(
      "Asked 8:10 PM PT · you"
    );
    expect(detailHeader(view({ kind: "on_behalf" }), reading).asked).toBe(
      "Filed by you for Marcus"
    );
    expect(
      detailHeader(view({ teamId: 9 }, { names: { team: null, manager: null } }), reading)
    ).toMatchObject({
      team: "Team 9",
      asked: "Asked 8:10 PM PT",
    });
  });
});

describe("detailStatus", () => {
  // Copy table 1, S1: what approving does is the button's; the line says when it expires.
  it("says when an approval expires, and nothing approving does", () => {
    expect(detailStatus(view(), reading)).toEqual({
      tone: "wait",
      word: "Needs you: approval",
      who: "",
      sentence: "Expires Tue 8:10 AM PT.",
    });
    expect(detailStatus(view({ expiresAt: null }), reading).sentence).toBe("");
  });

  it("adds nothing for your own team's approval; the header says it's yours", () => {
    expect(detailStatus(view(), { ...reading, ownTeam: true }).sentence).toBe("");
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
      who: "",
      sentence: "",
    });
    expect(
      detailStatus(
        view({ status: "queued" }, { blocked: "credentials_rejected", blockedSince: t }),
        reading
      )
    ).toEqual({
      tone: "busy",
      word: "Blocked",
      who: "You renew the ESPN cookie",
      sentence: "Refused at 8:10 PM PT; nothing sent. Marcus sees Delayed.",
    });
    expect(
      detailStatus(view({ status: "queued" }, { blocked: "not_connected" }), reading)
    ).toMatchObject({
      who: "You add the ESPN cookie",
      sentence: "Nothing sent. Marcus sees Delayed.",
    });
    expect(
      detailStatus(view({ status: "queued" }, { blocked: "unreachable", blockedSince: t }), reading)
    ).toMatchObject({
      who: "",
      sentence: "ESPN stopped answering at 8:10 PM PT; nothing sent. Marcus sees Delayed.",
    });
    expect(detailStatus(view({ status: "queued" }), reading)).toMatchObject({ who: "" });
  });

  it("names no manager who'd see Delayed on your own team", () => {
    const blocked = view(
      { status: "queued" },
      { blocked: "credentials_rejected", blockedSince: t }
    );
    expect(detailStatus(blocked, { ...reading, ownTeam: true }).sentence).toBe(
      "Refused at 8:10 PM PT; nothing sent."
    );
  });

  it("leaves a changed adjustment's two amounts to the panel", () => {
    const changed = view(
      { status: "needs_review", reviewReason: "adjustment_changed" },
      { facts: FACTS }
    );
    expect(detailStatus(changed, reading)).toMatchObject({
      word: "Needs you: adjustment changed",
      sentence: "",
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
      who: "On ESPN 8:10 PM PT",
      sentence: "Valančiūnas at C; −87.8 on Stretch Fours, week 4.",
    });
    expect(detailStatus(view({ status: "rejected" }), reading)).toMatchObject({
      tone: "neutral",
      word: "Rejected",
      sentence: "",
    });
    expect(detailStatus(view({ status: "withdrawn" }), reading).sentence).toBe("By Marcus.");
    expect(
      detailStatus(view({ status: "withdrawn" }), { ...reading, ownTeam: true }).sentence
    ).toBe("By you.");
    expect(detailStatus(view({ status: "refused" }), reading).sentence).toBe("At filing.");
    expect(detailStatus(view({ status: "completed_manually" }), reading)).toMatchObject({
      word: "Settled by hand",
      sentence: "",
    });
  });
});

describe("detailActions", () => {
  it("makes approval the one button, with the rest as text buttons and Reject last", () => {
    expect(detailActions(view())).toEqual({
      primary: { kind: "approve", label: "Approve · −31.0", shownTenths: -310 },
      links: [
        { form: "override", label: "Override" },
        { form: "complete", label: "Settle by hand" },
        { form: "reject", label: "Reject" },
      ],
    });
  });

  it("names a re-approval", () => {
    expect(
      detailActions(
        view(
          { status: "needs_review", reviewReason: "adjustment_changed" },
          {
            actions: ["reapprove", "override", "complete"],
            approval: { action: "reapprove", computedTenths: -878, overrideTenths: null },
          }
        )
      )
    ).toEqual({
      primary: { kind: "reapprove", label: "Re-approve · −87.8", shownTenths: -878 },
      links: [
        { form: "complete-adjustment", label: "Adjustment only, by hand" },
        { form: "override", label: "Override" },
      ],
    });
  });

  it("leads with settling by hand when nothing can be approved, and offers none while it runs", () => {
    expect(
      detailActions(view({}, { actions: ["reject", "override", "complete"], approval: null }))
    ).toEqual({
      primary: { kind: "form", form: "complete", label: "Settle by hand" },
      links: [
        { form: "override", label: "Override" },
        { form: "reject", label: "Reject" },
      ],
    });
    expect(detailActions(view({ status: "executing" }, { actions: [], approval: null }))).toEqual({
      primary: null,
      links: [],
    });
  });
});

describe("emailMark", () => {
  it("says the email provider refused the alert, or only that it didn't go out", () => {
    expect(emailMark({ state: "failed", at: t, code: "send_rejected" }, reading)).toBe(
      "The alert email for this request didn't go out: the email provider refused it at 8:10 PM PT."
    );
    expect(emailMark({ state: "failed", at: t, code: "send_unavailable" }, reading)).toBe(
      "The alert email for this request didn't go out at 8:10 PM PT."
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
    const own = detailRecord(
      view(
        {},
        {
          events: [{ eventType: "request_filed", actorType: "manager", createdAt: t, payload: {} }],
        }
      ),
      { ...reading, ownTeam: true }
    );
    expect(own.map(({ text }) => text)).toEqual(["You asked: Valančiūnas in for Sabonis"]);
    expect(records[0]?.time).toBe("8:10 PM PT");
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
  offIr: [],
  espnAnswer: null,
};

describe("held, changed, stale and check-ESPN requests", () => {
  it("names the rule that held the adjustment, listing no buttons", () => {
    const held = detailStatus(review("adjustment_held_rules", { facts: FACTS }), reading);
    expect(held.sentence).toContain("Steals points is 2 on ESPN; InjurySub expects 3");
    expect(held.sentence).not.toMatch(/re-approve|by hand/);
  });

  it("says a changed lineup sent nothing, and a check ESPN posted no adjustment", () => {
    const stale = detailStatus(review("stale"), reading).sentence;
    expect(stale).toContain("nothing was sent");
    expect(stale).not.toMatch(/re-checks/);
    expect(detailStatus(review("ambiguous"), reading).sentence).toContain(
      "no adjustment was posted"
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
      title: "Both adjustments",
      left: { k: "When you approved", v: "−82.1", s: "8:10 PM PT" },
      right: { k: "Now", v: "−87.8", s: "" },
    });
    expect(comparePanel(review("suspension"), reading)).toBeNull();
  });

  it("offers a held or changed amount's re-approval, then adjustment only by hand, then override", () => {
    const actions = detailActions(
      review("adjustment_held_rules", {
        actions: ["reapprove", "override", "complete"],
        approval: { action: "reapprove", computedTenths: -878, overrideTenths: null },
      })
    );
    expect(actions.links).toEqual([
      { form: "complete-adjustment", label: "Adjustment only, by hand" },
      { form: "override", label: "Override" },
    ]);
  });

  it("leads a held amount with posting the adjustment by hand when it can't be re-approved", () => {
    expect(
      detailActions(
        review("adjustment_held_rules", { actions: ["override", "complete"], approval: null })
      )
    ).toEqual({
      primary: { kind: "form", form: "complete-adjustment", label: "Adjustment only, by hand" },
      links: [{ form: "override", label: "Override" }],
    });
  });
});
