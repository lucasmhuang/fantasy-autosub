import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every control the components render takes its size from the system's CSS: each class must
// make a touch target at least 44 px tall.
const vendorDir = new URL("../../vendor/design-system-v17/", import.meta.url).pathname;
const CONTROLS = [
  ".btn",
  ".btn-l",
  ".btn-sec",
  ".btn-ghost",
  ".btn-quiet",
  ".acct",
  ".tab",
  ".topnav a",
  ".input",
];
const MINIMUM_TARGET = 44;

function systemCss(): string {
  const css =
    readFileSync(`${vendorDir}tokens.css`, "utf8") + readFileSync(`${vendorDir}bundle.css`, "utf8");
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pixels(value: string, css: string): number {
  const token = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
  const resolved = token ? new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1] : value;
  return Number.parseFloat(resolved ?? "") || 0;
}

// The tallest height or min-height that rules naming exactly this selector give it.
function targetHeight(selector: string, css: string): number {
  const heights = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors = ""]) => selectors.split(",").some((part) => part.trim() === selector))
    .flatMap(([, , body = ""]) => [...body.matchAll(/(?<![\w-])(?:min-)?height:\s*([^;]+)/g)])
    .map(([, value = ""]) => pixels(value, css));
  return Math.max(0, ...heights);
}

describe("the components' controls", () => {
  it.each(CONTROLS)("%s is a touch target of at least 44 px", (selector) => {
    expect(targetHeight(selector, systemCss())).toBeGreaterThanOrEqual(MINIMUM_TARGET);
  });
});
