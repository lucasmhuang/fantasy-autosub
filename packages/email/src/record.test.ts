import { describe, expect, it } from "vitest";
import { type EmailRecord, emailAmount, surname, textPartOf } from "./record";

const ALERT: EmailRecord = {
  kind: "alert",
  subject: "Stretch Fours needs you",
  lead: "A request from Stretch Fours is waiting for your approval.",
  facts: [
    { label: "Swap", value: "Jonas Valančiūnas in for Domantas Sabonis · C slot" },
    { label: "Asked", value: "Wed Nov 11, 4:02 PM PT, by Marcus" },
    { label: "Adjustment", value: "−31.0", meta: "projected", tone: "out" },
  ],
};

describe("textPartOf", () => {
  // The friends voice (owner, 2026-11-17): the first sentence and the facts, and nothing after.
  it("lays the text part out as the lead, then the facts as label and value, with nothing after them", () => {
    expect(textPartOf(ALERT)).toBe(
      [
        "A request from Stretch Fours is waiting for your approval.",
        "",
        "Swap: Jonas Valančiūnas in for Domantas Sabonis · C slot",
        "Asked: Wed Nov 11, 4:02 PM PT, by Marcus",
        "Adjustment: −31.0 projected",
      ].join("\n")
    );
  });

  it("puts a paragraph after the lead and ends on it", () => {
    const record: EmailRecord = {
      kind: "code",
      subject: "Sign in to InjurySub",
      lead: "Your InjurySub sign-in code is 482913.",
      code: "482913",
      body: ["Expires in 10 minutes."],
    };
    expect(textPartOf(record).split("\n")).toEqual([record.lead, "", "Expires in 10 minutes."]);
  });

  it("says a sign-in code once, in its sentence, never the large copy", () => {
    const record: EmailRecord = {
      kind: "code",
      subject: "Sign in to InjurySub",
      lead: "Your InjurySub sign-in code is 482913.",
      code: "482913",
      body: ["Expires in 10 minutes."],
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
