import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Rule, rulesOf } from "./css-test-support";

// FS-FORM-1: selects, radios, checkboxes and the time field drawn in the system's style, from the
// app's controls layer (the vendored system stays unedited, AC1-5).
const controlsUrl = new URL("./controls.css", import.meta.url);
const controlsCss = () => readFileSync(controlsUrl, "utf8");
const tokensCss = readFileSync(
  new URL("../../../packages/ui/vendor/design-system-v17/tokens.css", import.meta.url),
  "utf8"
);

const RADIOS = ['.radio-row input[type="radio"]', '.pick input[type="radio"]'];
const CHECKBOX = '.check input[type="checkbox"]';

function rulesWith(selector: string): Rule[] {
  return rulesOf(controlsCss()).filter((rule) =>
    rule.selectors.some((each) => each === selector || each.startsWith(selector))
  );
}

const bodies = (rules: Rule[]) => rules.map((rule) => rule.body).join("\n");

describe("the controls layer", () => {
  it("is imported after the system's components, in the same layer", () => {
    const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const system = globals.indexOf("design-system-v17/bundle.css");
    const controls = globals.indexOf('@import "./controls.css" layer(components);');

    expect(existsSync(controlsUrl)).toBe(true);
    expect(controls).toBeGreaterThan(system);
  });

  it.each([
    ...RADIOS,
    CHECKBOX,
  ])("draws %s, with checked, focus and disabled states", (selector) => {
    const rules = rulesWith(selector);
    const own = rules.filter((rule) => rule.selectors.includes(selector));

    expect(bodies(own)).toMatch(/appearance:\s*none/);
    expect(rules.some((rule) => rule.selectors.some((each) => each.includes(":checked")))).toBe(
      true
    );
    expect(
      rules.some((rule) => rule.selectors.some((each) => each.includes(":focus-visible")))
    ).toBe(true);
    expect(rules.some((rule) => rule.selectors.some((each) => each.includes(":disabled")))).toBe(
      true
    );
  });

  it("styles the open list only where the browser can, and keeps the drawn chevron", () => {
    const rules = rulesOf(controlsCss());
    const baseSelect = rules.filter((rule) => /appearance:\s*base-select/.test(rule.body));

    expect(baseSelect.length).toBeGreaterThan(0);
    for (const rule of baseSelect) {
      expect(rule.within).toContain("@supports (appearance: base-select)");
    }
    expect(
      rules.some((rule) => rule.selectors.some((each) => each.includes("::picker(select)")))
    ).toBe(true);
    const icon = rules.find((rule) => rule.selectors.includes(".select::picker-icon"));
    expect(icon?.body).toMatch(/display:\s*none/);
  });

  // Found by AP-4's walk: drawn as base-select, the closed field put its text at the top.
  it("keeps the closed field's text centred when the browser draws the list", () => {
    const select = rulesOf(controlsCss()).find(
      (rule) =>
        rule.selectors.includes(".select") &&
        rule.selectors.length === 1 &&
        rule.within.includes("@supports (appearance: base-select)")
    );
    expect(select?.body).toMatch(/align-items:\s*center/);
  });

  it("gives each option in the open list a touch target of at least 44 px", () => {
    const option = rulesOf(controlsCss()).find((rule) => rule.selectors.includes(".select option"));
    expect(option?.body).toMatch(/min-height:\s*var\(--size-target\)/);
    expect(tokensCss).toMatch(/--size-target:\s*44px/);
  });

  it("draws the time field's inside in the field's type and colours", () => {
    const rules = rulesOf(controlsCss());
    const edit = rules.find((rule) =>
      rule.selectors.some((each) => each.includes("::-webkit-datetime-edit"))
    );
    const indicator = rules.find((rule) =>
      rule.selectors.some((each) => each.includes("::-webkit-calendar-picker-indicator"))
    );

    expect(edit?.body).toContain("var(--text)");
    expect(indicator).toBeDefined();
  });

  it("takes every colour from the system's tokens", () => {
    const withoutMasks = controlsCss().replace(/url\("data:[^"]*"\)/g, "");
    expect(withoutMasks).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
