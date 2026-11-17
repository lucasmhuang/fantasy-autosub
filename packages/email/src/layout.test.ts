import { describe, expect, it } from "vitest";
import { type EmailRecord, textPartOf } from "./record";
import { renderEmail } from "./render";
import { scanEmailHtml, visibleTextOf } from "./test-support";

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
  body: ["Approving re-checks ESPN, then makes the swap and posts −31.0."],
  action: "Approve it, settle it by hand or reject it in InjurySub’s queue.",
  note: "A quieter note.",
  foot: FOOT,
};

const CODE: EmailRecord = {
  kind: "code",
  subject: "Sign in to InjurySub",
  lead: "Your InjurySub sign-in code is 482913.",
  code: "482913",
  body: ["Enter it in InjurySub to finish signing in."],
  foot: ["Not affiliated with ESPN or the NBA."],
};

describe("renderEmail", () => {
  it("draws every word of the record in order, the same words as the text part", async () => {
    const { html, text } = await renderEmail(ALERT);
    expect(visibleTextOf(html)).toEqual([
      ALERT.lead,
      "Swap",
      "Jonas Valančiūnas in for Domantas Sabonis · C slot",
      "Asked",
      "Wed Nov 11, 4:02 PM PT, by Marcus",
      "Adjustment",
      "−31.0 projected",
      "Approving re-checks ESPN, then makes the swap and posts −31.0.",
      ALERT.action,
      "A quieter note.",
      ...FOOT,
    ]);
    expect(text).toBe(textPartOf(ALERT));
  });

  it("carries no link, image, button, URL, domain or address", async () => {
    const { html } = await renderEmail(ALERT);
    expect(scanEmailHtml(html)).toEqual([]);
  });

  it("opens with the code's sentence, and shows the code large, hidden from screen readers and from the text part", async () => {
    const { html } = await renderEmail(CODE);
    expect(visibleTextOf(html)[0]).toBe("Your InjurySub sign-in code is 482913.");
    expect(html.indexOf("Your InjurySub sign-in code is ")).toBeLessThan(
      html.indexOf("data-skip-in-text")
    );
    const block = html.match(/<table[^>]*data-skip-in-text="true"[^>]*>[\s\S]*?<\/table>/)?.[0];
    expect(block).toContain('aria-hidden="true"');
    expect(block).toMatch(/>482<span style="margin-left:0\.32em">913<\/span>/);
    expect(scanEmailHtml(html)).toEqual([]);
  });

  // Gmail's iOS and Android apps honour only `light only` and invert anything else, this dark
  // email included (FS-EMAIL-4; the 2026-11-17 direct-send spike).
  it("declares the email light only, so no client recolours it, and keeps times and numbers from becoming links", async () => {
    const { html } = await renderEmail(ALERT);
    expect(html).toContain(
      '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no"/>'
    );
    expect(html).toContain('<meta name="color-scheme" content="light only"/>');
    expect(html).toContain('<meta name="supported-color-schemes" content="light only"/>');
    expect(html).not.toContain('content="dark"');
    expect(html).toMatch(/a\[x-apple-data-detectors\]\s*\{[^}]*color:\s*inherit/);
  });

  it("paints the ground and the facts panel in step 6's colours", async () => {
    const { html } = await renderEmail(ALERT);
    expect(html).toMatch(/<body[^>]*background-color:#0c0c0d/);
    expect(html).toMatch(/background-color:#161618;border:1px solid #3a3a3f;border-radius:16px/);
    expect(html).toContain("color:#ff9592");
  });
});
