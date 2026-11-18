import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const webDir = new URL("..", import.meta.url).pathname;
const uiSourceDir = new URL("../../../packages/ui/src/", import.meta.url).pathname;

// The classes a stylesheet's selectors name (not its values or its at-rules' conditions).
function selectorClasses(path: string): Set<string> {
  const css = withoutComments(readFileSync(path, "utf8"));
  const selectors = [...css.matchAll(/([^{};]+)\{/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((selector) => !selector.startsWith("@"));
  return new Set(
    selectors.flatMap((selector) =>
      [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? "")
    )
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.|test-support/.test(entry.name) ? [path] : [];
  });
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

  // The vendored InterVariable.woff2 holds every script Inter covers (345 KB), which held every
  // photo-first page's simulated LCP over 2.5 s; next/font serves each script's range on demand and preloads the Latin one.
  it("gives the UI font the variable that next/font sets for Inter, preloading the Latin subset only", () => {
    const layout = readFileSync(layoutPath, "utf8");
    const theme = withoutComments(readFileSync(themePath, "utf8"));
    const interCall = /\bInter\(\{([^}]*)\}\)/.exec(layout)?.[1] ?? "";
    const setByNextFont = /variable:\s*"(--[\w-]+)"/.exec(interCall)?.[1];
    const subsets = /subsets:\s*\[([^\]]*)\]/.exec(interCall)?.[1]?.match(/"[\w-]+"/g);
    const readByTheme = /--font-ui:\s*var\((--[\w-]+)\)/.exec(theme)?.[1];

    expect(setByNextFont).toBeDefined();
    expect(readByTheme).toBe(setByNextFont);
    expect(subsets).toEqual(['"latin"']);
  });

  it("never names the vendored Inter face, so its file is never fetched", () => {
    const layout = readFileSync(layoutPath, "utf8");
    const theme = withoutComments(readFileSync(themePath, "utf8"));
    const uiStack = /--font-ui:\s*([^;]*);/.exec(theme)?.[1];

    expect(uiStack).toBeDefined();
    expect(uiStack).not.toMatch(/"Inter"/);
    expect(layout).not.toMatch(/interFontHref|preload\(/);
  });

  // The pages built before the design system had their own palette and classes here.
  it("declares no custom property of its own: colours and sizes come from the design system", () => {
    expect([...declaredProperties(globalsPath)]).toEqual([]);
  });

  it("styles only classes the app's markup uses", () => {
    const markup = [...sourceFiles(webDir), ...sourceFiles(uiSourceDir)]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const unused = [...selectorClasses(globalsPath)].filter(
      (name) => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(markup)
    );

    expect(selectorClasses(globalsPath).size).toBeGreaterThan(20);
    expect(unused).toEqual([]);
  });
});
