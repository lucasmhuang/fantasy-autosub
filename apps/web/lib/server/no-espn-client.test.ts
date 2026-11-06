import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The web never holds the ESPN cookie or builds an ESPN client (Dec-D1): its ESPN reads go
// through the worker's internal API. This scans the app's own source, tests excluded.
const webRoot = new URL("../../", import.meta.url).pathname;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", "e2e"]);
const FORBIDDEN = ["createEspnClient", "createEspnReadClient", "ESPN_S2"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    const isSource = /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

describe("the web app's source", () => {
  it("never builds an ESPN client or reads the ESPN cookie", () => {
    const files = sourceFiles(webRoot);
    const hits = files.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return FORBIDDEN.filter((name) => text.includes(name)).map(
        (name) => `${relative(webRoot, path)}: ${name}`
      );
    });

    expect(files.length).toBeGreaterThan(10);
    expect(hits).toEqual([]);
  });
});
