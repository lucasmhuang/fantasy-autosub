import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The design system's CSS and font are vendored unedited (packages/ui/vendor/), so a later
// system version diffs file to file. These checks run in CI, where the system's own sources
// aren't available.
const vendorDir = new URL("../vendor/design-system-v17/", import.meta.url).pathname;
const themePath = new URL("./styles/theme.css", import.meta.url).pathname;
const UNHASHED = new Set(["SHA256SUMS", "README.md"]);

type ChecksumLine = { hash: string; path: string };

function readChecksums(): ChecksumLine[] {
  const lines = readFileSync(join(vendorDir, "SHA256SUMS"), "utf8").trim().split("\n");
  return lines.map((line) => {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    expect(match, `SHA256SUMS line: ${line}`).not.toBeNull();
    return { hash: match?.[1] ?? "", path: match?.[2] ?? "" };
  });
}

function vendoredFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return vendoredFiles(path);
    const name = relative(vendorDir, path);
    return UNHASHED.has(name) ? [] : [name];
  });
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function vendoredCss(): string {
  return withoutComments(
    readFileSync(join(vendorDir, "tokens.css"), "utf8") +
      readFileSync(join(vendorDir, "bundle.css"), "utf8")
  );
}

function declaredProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? ""));
}

// The colour tokens: the custom properties of tokens.css's theme block, shadows aside.
function colourTokens(): string[] {
  const tokens = withoutComments(readFileSync(join(vendorDir, "tokens.css"), "utf8"));
  const block = /:root, \[data-theme="dark"\] \{([^}]*)\}/.exec(tokens)?.[1] ?? "";
  return [...declaredProperties(block)].filter((name) => !name.startsWith("--shadow-"));
}

describe("the vendored design system", () => {
  it("matches the checksum recorded for each file", () => {
    const checksums = readChecksums();

    expect(checksums.length).toBeGreaterThanOrEqual(3);
    for (const { hash, path } of checksums) {
      const actual = createHash("sha256")
        .update(readFileSync(join(vendorDir, path)))
        .digest("hex");
      expect(actual, path).toBe(hash);
    }
  });

  it("records a checksum for every vendored file and for nothing else", () => {
    const recorded = readChecksums().map(({ path }) => path);

    expect(vendoredFiles(vendorDir).sort()).toEqual([...recorded].sort());
  });

  it("defines every custom property its CSS reads without a fallback", () => {
    const css = vendoredCss();
    const defined = new Set([
      ...declaredProperties(css),
      ...declaredProperties(withoutComments(readFileSync(themePath, "utf8"))),
    ]);
    const read = new Set([...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((match) => match[1]));

    expect(read.size).toBeGreaterThan(50);
    expect([...read].filter((name) => name !== undefined && !defined.has(name))).toEqual([]);
  });
});

describe("the app's theme over the system", () => {
  it("maps every colour token into Tailwind's theme", () => {
    const theme = withoutComments(readFileSync(themePath, "utf8"));
    const mapped = /@theme inline \{([^}]*)\}/.exec(theme)?.[1] ?? "";
    const tokens = colourTokens();

    expect(tokens.length).toBeGreaterThan(50);
    expect(
      tokens.filter((name) => !mapped.includes(`--color-${name.slice(2)}: var(${name});`))
    ).toEqual([]);
  });
});
