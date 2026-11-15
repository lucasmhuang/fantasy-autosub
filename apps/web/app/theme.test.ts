import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The app's stylesheet sits beside the vendored design system (packages/ui/vendor/), whose
// custom properties the old pages take too. A property defined in both places would make the
// system's value depend on which rule wins.
const globalsPath = new URL("./globals.css", import.meta.url).pathname;
const layoutPath = new URL("./layout.tsx", import.meta.url).pathname;
const vendorDir = new URL("../../../packages/ui/vendor/design-system-v17/", import.meta.url)
  .pathname;
const themePath = new URL("../../../packages/ui/src/styles/theme.css", import.meta.url).pathname;

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function declaredProperties(path: string): Set<string> {
  const css = withoutComments(readFileSync(path, "utf8"));
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? ""));
}

describe("the app's stylesheet", () => {
  it("defines no custom property the design system or its theme defines", () => {
    const system = new Set([
      ...declaredProperties(`${vendorDir}tokens.css`),
      ...declaredProperties(`${vendorDir}bundle.css`),
      ...declaredProperties(themePath),
    ]);

    expect(system.size).toBeGreaterThan(100);
    expect([...declaredProperties(globalsPath)].filter((name) => system.has(name))).toEqual([]);
  });

  it("gives the display font the variable that next/font sets", () => {
    const layout = readFileSync(layoutPath, "utf8");
    const theme = withoutComments(readFileSync(themePath, "utf8"));
    const setByNextFont = /Barlow_Condensed\(\{[^}]*variable:\s*"(--[\w-]+)"/.exec(layout)?.[1];
    const readByTheme = /--font-display:\s*var\((--[\w-]+)\)/.exec(theme)?.[1];

    expect(setByNextFont).toBeDefined();
    expect(readByTheme).toBe(setByNextFont);
  });
});
