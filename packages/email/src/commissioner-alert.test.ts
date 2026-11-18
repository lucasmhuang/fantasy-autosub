import { describe, expect, it } from "vitest";
import type { AlertSituation, CommissionerAlertInput } from "./commissioner-alert";
import { buildCommissionerOutboxEmail } from "./index";
import { scanEmailHtml, visibleTextOf } from "./test-support";

const ASKED = new Date("2026-11-12T00:02:00.000Z"); // Wed Nov 11, 4:02 PM PT
const EXPIRES = new Date("2026-11-12T12:02:00.000Z"); // Thu 4:02 AM PT

const BASE: CommissionerAlertInput = {
  to: "commissioner@example.test",
  requestId: "1b2c3d4e-0000-4000-8000-000000000000",
  version: 3,
  teamId: 4,
  teamName: "Stretch Fours",
  injuredName: "Domantas Sabonis",
  replacementName: "Jonas Valančiūnas",
  slot: "C",
  askedAt: ASKED,
  askedBy: "Marcus",
  amount: { tenths: -310, kind: "projected" },
  situation: { kind: "approval", expiresAt: EXPIRES },
};

function review(situation: AlertSituation, input: Partial<CommissionerAlertInput> = {}) {
  return buildCommissionerOutboxEmail({ ...BASE, ...input, situation });
}

function linesOf(body: string): string[] {
  return body.split("\n");
}

// The friends voice (owner, 2026-11-17): the commissioner built InjurySub, so an alert is its
// first sentence and its facts, and every line after the first is a fact.
function nonFactLines(body: string): string[] {
  return linesOf(body)
    .slice(2)
    .filter((line) => !/^[A-Z][a-z]+: \S/.test(line));
}

describe("the commissioner's alert", () => {
  // FS-EMAIL-7, -11.
  it("asks for approval with the swap, who asked and when, the projected amount and the deadline, and nothing more", async () => {
    const email = await buildCommissionerOutboxEmail(BASE);

    expect(email.subject).toBe("Stretch Fours needs you");
    expect(linesOf(email.body)).toEqual([
      "A request from Stretch Fours is waiting for your approval.",
      "",
      "Swap: Jonas Valančiūnas in for Domantas Sabonis · C slot",
      "Asked: Wed Nov 11, 4:02 PM PT, by Marcus",
      "Adjustment: −31.0 projected",
      "Expires: Thu 4:02 AM PT",
    ]);
    // The same words in the HTML, each fact's label above its value.
    expect(visibleTextOf(email.html)).toEqual([
      "A request from Stretch Fours is waiting for your approval.",
      "Swap",
      "Jonas Valančiūnas in for Domantas Sabonis · C slot",
      "Asked",
      "Wed Nov 11, 4:02 PM PT, by Marcus",
      "Adjustment",
      "−31.0 projected",
      "Expires",
      "Thu 4:02 AM PT",
    ]);
    expect(scanEmailHtml(email.html)).toEqual([]);
  });

  it("keys the email by the request and its version after the change, and names the request", async () => {
    expect(await buildCommissionerOutboxEmail(BASE)).toMatchObject({
      dedupeKey: "1b2c3d4e-0000-4000-8000-000000000000:3",
      requestId: "1b2c3d4e-0000-4000-8000-000000000000",
      toAddress: "commissioner@example.test",
    });
  });

  // FS-EMAIL-10 and copy table 1 (S2): the reason's one fact, shared with the queue and the
  // detail, or its pill where the pill says it all; no line that isn't a fact.
  it.each<[string, AlertSituation, string]>([
    ["automation off", { kind: "review", reason: "automation_off" }, "Automation off."],
    ["not ticked", { kind: "review", reason: "not_allowlisted" }, "Not ticked."],
    [
      "a rearrangement",
      {
        kind: "review",
        reason: "rearrangement",
        moves: [
          { name: "Lauri Markkanen", toSlot: "F/C" },
          { name: "Bam Adebayo", toSlot: "BE" },
        ],
      },
      "Markkanen to F/C, Adebayo to BN",
    ],
    ["a suspension", { kind: "review", reason: "suspension" }, "Sabonis is suspended"],
    ["a lineup that changed", { kind: "review", reason: "stale" }, "nothing was sent"],
    ["a lineup that didn't match", { kind: "review", reason: "ambiguous" }, "no adjustment"],
    ["a refused lineup", { kind: "review", reason: "lineup_failed" }, "refused the lineup"],
    ["a refused adjustment", { kind: "review", reason: "adjustment_failed" }, "−31.0"],
    [
      "a held adjustment",
      {
        kind: "review",
        reason: "adjustment_held_rules",
        rules: { first: "Steals score 2 on ESPN; InjurySub expects 3", more: 0 },
      },
      "Steals score 2 on ESPN; InjurySub expects 3",
    ],
    ["an expired request", { kind: "review", reason: "expired", hours: 12 }, "12 hours"],
    ["a week that ended", { kind: "review", reason: "week_ended", week: 4 }, "Week 4"],
    ["a playoff week", { kind: "review", reason: "playoffs" }, "Playoffs."],
  ])("words %s", async (_name, situation, fact) => {
    const email = await review(situation);
    const [lead = ""] = linesOf(email.body);

    expect(lead).toMatch(/^A request from Stretch Fours needs you\. /);
    expect(lead).toContain(fact);
    expect(linesOf(email.body).filter((line) => /^(Moves|Rules): /.test(line))).toEqual([]);
    expect(nonFactLines(email.body)).toEqual([]);
    expect(scanEmailHtml(email.html)).toEqual([]);
  });

  it("shows a changed amount as now and when approved, in place of the plain amount", async () => {
    const email = await review(
      { kind: "review", reason: "adjustment_changed", nowTenths: -334, thenTenths: -310 },
      { amount: { tenths: -334, kind: "computed" } }
    );
    const lines = linesOf(email.body);

    expect(lines[0]).toBe("A request from Stretch Fours needs you. Adjustment changed.");
    expect(lines.filter((line) => line.startsWith("Adjustment: "))).toEqual([
      "Adjustment: −33.4 now, −31.0 when approved",
    ]);
    expect(nonFactLines(email.body)).toEqual([]);
  });

  // FS-EMAIL-7 and Revision 6 K: the amount says which it is.
  it.each<[string, Partial<CommissionerAlertInput>, string]>([
    [
      "projected when asked, on expiry",
      { situation: { kind: "review", reason: "expired", hours: 12 } },
      "Adjustment: −31.0 projected when asked",
    ],
    [
      "projected when asked, once the week ended",
      { situation: { kind: "review", reason: "week_ended", week: 4 } },
      "Adjustment: −31.0 projected when asked",
    ],
    [
      "computed by the worker",
      { amount: { tenths: -334, kind: "computed" } },
      "Adjustment: −33.4 computed",
    ],
    ["settled", { amount: { tenths: 51, kind: "settled" } }, "Adjustment: +5.1"],
    ["none owed", { amount: { tenths: null, kind: "projected" } }, "Adjustment: None"],
    ["none owed at zero", { amount: { tenths: 0, kind: "projected" } }, "Adjustment: None"],
  ])("labels an amount %s", async (_name, input, line) => {
    const email = await buildCommissionerOutboxEmail({ ...BASE, ...input });
    expect(linesOf(email.body)).toContain(line);
  });

  it("gives the approval deadline when no adjustment is owed", async () => {
    const email = await buildCommissionerOutboxEmail({
      ...BASE,
      amount: { tenths: null, kind: "projected" },
    });
    expect(linesOf(email.body).slice(-2)).toEqual(["Adjustment: None", "Expires: Thu 4:02 AM PT"]);
  });

  // FS-APP-14: a person by first name.
  it("names who asked by first name", async () => {
    const email = await buildCommissionerOutboxEmail({ ...BASE, askedBy: "Marcus Invented" });
    expect(linesOf(email.body)).toContain("Asked: Wed Nov 11, 4:02 PM PT, by Marcus");
  });

  it("gives when it was asked without a name when the team has no account", async () => {
    const email = await buildCommissionerOutboxEmail({ ...BASE, askedBy: null });
    expect(linesOf(email.body)).toContain("Asked: Wed Nov 11, 4:02 PM PT");
  });

  it("names the first rule that differed and counts the rest", async () => {
    const email = await review({
      kind: "review",
      reason: "adjustment_held_rules",
      rules: { first: "Steals score 2 on ESPN; InjurySub expects 3", more: 2 },
    });
    expect(linesOf(email.body)[0]).toContain(
      "Steals score 2 on ESPN; InjurySub expects 3; and 2 more"
    );
  });

  it("names who comes off IR and the week after the request's when next week is full", async () => {
    const email = await review({
      kind: "review",
      reason: "next_week_full",
      week: 4,
      offIr: ["Domantas Sabonis"],
    });
    expect(linesOf(email.body)[0]).toContain(
      "Sabonis is on IR from week 5, and that week's roster is full."
    );
  });

  // FS-EMAIL-9: the number only without a name, never both.
  it("names a team without a stored name by its number", async () => {
    const email = await buildCommissionerOutboxEmail({ ...BASE, teamName: null, teamId: 3 });
    expect(email.subject).toBe("Team 3 needs you");
    expect(linesOf(email.body)[0]).toBe("A request from Team 3 is waiting for your approval.");
    expect(email.body).not.toContain("(team 3)");
  });

  it("calls the bench BN", async () => {
    const email = await buildCommissionerOutboxEmail({ ...BASE, slot: "BE" });
    expect(linesOf(email.body)).toContain(
      "Swap: Jonas Valančiūnas in for Domantas Sabonis · BN slot"
    );
  });
});
