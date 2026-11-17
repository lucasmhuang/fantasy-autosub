import { describe, expect, it } from "vitest";
import { type EmailRecord, emailAmount, surname, textPartOf } from "./record";

const FOOT = [
  "Sent to you as the league’s commissioner on InjurySub.",
  "Not affiliated with ESPN or the NBA.",
];

const ALERT: EmailRecord = {
  kind: "alert",
  subject: "Stretch Fours needs you",
  lead: "A request from Stretch Fours is waiting for your approval.",
  facts: [
    { label: "Swap", value: "Jonas Valančiūnas in for Domantas Sabonis · C slot" },
    { label: "Asked", value: "Wed Nov 11, 4:02 PM PT, by Marcus" },
    { label: "Adjustment", value: "−31.0", meta: "projected", tone: "out" },
  ],
  body: [
    "Approving re-checks ESPN, then makes the swap and posts −31.0. If it isn’t approved by Thu 4:02 AM PT, it expires and stays in your queue.",
  ],
  action: "Approve it, settle it by hand or reject it in InjurySub’s queue.",
  foot: FOOT,
};

describe("textPartOf", () => {
  it("lays the text part out as step 6 does: the lead, the facts as label and value, then the paragraphs, the closing line and the footer", () => {
    expect(textPartOf(ALERT)).toBe(
      [
        "A request from Stretch Fours is waiting for your approval.",
        "",
        "Swap: Jonas Valančiūnas in for Domantas Sabonis · C slot",
        "Asked: Wed Nov 11, 4:02 PM PT, by Marcus",
        "Adjustment: −31.0 projected",
        "",
        "Approving re-checks ESPN, then makes the swap and posts −31.0. If it isn’t approved by Thu 4:02 AM PT, it expires and stays in your queue.",
        "",
        "Approve it, settle it by hand or reject it in InjurySub’s queue.",
        "",
        "Sent to you as the league’s commissioner on InjurySub.",
        "Not affiliated with ESPN or the NBA.",
      ].join("\n")
    );
  });

  it("puts the quieter note after the closing line", () => {
    const record: EmailRecord = {
      kind: "alert",
      subject: "Misuse watch: Backdoor Cutters",
      lead: "Someone made a league-manager lineup change on Backdoor Cutters that InjurySub didn’t make.",
      action: "Undo it on ESPN, or acknowledge it in InjurySub’s misuse watch if you made it.",
      note: "Removing InjurySub’s copy of the ESPN cookie doesn’t stop the cookie working.",
      foot: FOOT,
    };
    expect(textPartOf(record).split("\n")).toEqual([
      record.lead,
      "",
      record.action,
      "",
      record.note,
      "",
      ...FOOT,
    ]);
  });

  it("says a sign-in code once, in its sentence, never the large copy", () => {
    const record: EmailRecord = {
      kind: "code",
      subject: "Sign in to InjurySub",
      lead: "Your InjurySub sign-in code is 482913.",
      code: "482913",
      body: ["Enter it in InjurySub to finish signing in."],
      foot: ["Not affiliated with ESPN or the NBA."],
    };
    const text = textPartOf(record);
    expect(text.split("482913")).toHaveLength(2);
    expect(text).not.toContain("482 913");
  });
});

describe("emailAmount", () => {
  it("signs an amount and writes a minus sign, not a hyphen, as step 6 draws it", () => {
    expect(emailAmount(-310)).toBe("−31.0");
    expect(emailAmount(51)).toBe("+5.1");
    expect(emailAmount(0)).toBe("0.0");
  });
});

describe("surname", () => {
  it("keeps every word after the first, and a one-word name whole", () => {
    expect(surname("Keegan Murray")).toBe("Murray");
    expect(surname("Jaren Jackson Jr.")).toBe("Jackson Jr.");
    expect(surname("Nenê")).toBe("Nenê");
  });
});
