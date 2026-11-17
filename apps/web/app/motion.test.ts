import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Rule, rulesOf } from "./css-test-support";

// The motion spec's small motions, as the app's and the design system's CSS state them (IF-MOTION-7
// and -10 to -17). Each item is read from the rule that plays it: its duration token, and whether
// Reduce Motion keeps it.
const appCss = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const systemCss = readFileSync(
  new URL("../../../packages/ui/vendor/design-system-v17/bundle.css", import.meta.url),
  "utf8"
);

const RULES = [...rulesOf(appCss), ...rulesOf(systemCss)];

function rulesFor(selector: string): Rule[] {
  return RULES.filter((rule) => rule.selectors.includes(selector));
}

const keptWhenReduced = (rule: Rule) =>
  !rule.within.some((each) => each.includes("prefers-reduced-motion: no-preference"));

// The one rule that animates or transitions this selector, with the property it sets.
function motionOf(selector: string, property: "animation" | "transition") {
  const found = rulesFor(selector).filter((rule) => new RegExp(`${property}\\s*:`).test(rule.body));
  expect(found, `${selector} ${property}`).toHaveLength(1);
  const [rule] = found as [Rule];
  return { rule, value: new RegExp(`${property}\\s*:([^;]+)`).exec(rule.body)?.[1] ?? "" };
}

describe("the motion spec's small motions", () => {
  it("IF-MOTION-10: placeholders wait 300 ms, then fade in over 150 ms, in both versions", () => {
    const { rule, value } = motionOf(".shell-main.is-loading > .page", "animation");
    expect(value).toContain("var(--delay-loader)");
    expect(value).toContain("var(--dur-hover)");
    expect(keptWhenReduced(rule)).toBe(true);
  });

  it("IF-MOTION-10: a page that replaces its placeholders fades in over 200 ms, in both versions", () => {
    const { rule, value } = motionOf(".shell-main.arrives > .page", "animation");
    expect(value).toContain("var(--dur-status)");
    expect(keptWhenReduced(rule)).toBe(true);
  });

  it("IF-MOTION-13: an opened disclosure fades in over 200 ms, and appears at once when reduced", () => {
    const { rule, value } = motionOf("details[open] > :not(summary)", "animation");
    expect(value).toContain("var(--dur-status)");
    expect(keptWhenReduced(rule)).toBe(false);
  });

  it("IF-MOTION-17: a field's error fades in over 200 ms, and appears at once when reduced", () => {
    const { rule, value } = motionOf(".field-error", "animation");
    expect(value).toContain("var(--dur-status)");
    expect(keptWhenReduced(rule)).toBe(false);
  });

  it("IF-MOTION-14: a pressed control scales to 0.97, never when reduced", () => {
    const pressed = rulesFor(".btn:active").filter((rule) => rule.body.includes("scale(0.97)"));
    expect(pressed).toHaveLength(1);
    expect(keptWhenReduced(pressed[0] as Rule)).toBe(false);
    expect(motionOf(".btn", "transition").value).toContain("transform var(--dur-press)");
  });

  it("IF-MOTION-15: a control's colour changes over 150 ms on hover, in both versions", () => {
    const { rule, value } = motionOf(".btn", "transition");
    expect(value).toContain("background-color var(--dur-hover)");
    expect(keptWhenReduced(rule)).toBe(true);
  });

  it("IF-MOTION-16: a switch's thumb slides over 150 ms, and only its colour changes when reduced", () => {
    const slides = rulesFor(".switch::after").filter((rule) => /transition\s*:/.test(rule.body));
    const full = slides.find((rule) => !rule.within.some((each) => each.includes("reduce)")));
    const reduced = slides.find((rule) =>
      rule.within.some((each) => each.includes("prefers-reduced-motion: reduce"))
    );
    expect(full?.body).toContain("transform var(--dur-hover)");
    expect(reduced?.body).not.toContain("transform");
    expect(reduced?.body).toContain("background-color");
  });

  it("IF-MOTION-7: the active tracker step's halo pulses, and holds still when reduced", () => {
    const { rule, value } = motionOf(".step-dot.active", "animation");
    expect(value).toContain("var(--dur-pulse)");
    expect(keptWhenReduced(rule)).toBe(false);
  });

  it("IF-MOTION-12: moving to another page has no transition", () => {
    expect(`${appCss}${systemCss}`).not.toMatch(/@view-transition|view-transition-name/);
  });
});
