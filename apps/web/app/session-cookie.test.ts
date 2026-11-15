import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// RS-SIGNIN-7: the session cookie is set only by the redirect that answers the sign-in form's
// own POST, and cleared only by sign-out's. Safari caps a cookie set on a fetch, so a cookie
// written anywhere else (another route, a server action) could lapse within days. This scans
// the app's own source, tests excluded.
const webRoot = new URL("../", import.meta.url).pathname;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", "e2e"]);
const COOKIE_HELPERS = "lib/server/auth.ts";
// `response.cookies.set(`, `(await cookies()).set(`, `cookieStore.delete(`, a raw header.
const COOKIE_WRITE = /\b\w*cookie\w*(?:\(\))?\)?\s*\.\s*(?:set|delete)\s*\(|set-cookie/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    const isSource = /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(webRoot)
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(webRoot, path))
    .sort();
}

describe("the web app's source", () => {
  it("sets the session cookie only in verify-code, and clears it only in logout", () => {
    expect(filesMatching(/\bapplySessionCookie\(/)).toEqual([
      "app/auth/verify-code/route.ts",
      COOKIE_HELPERS,
    ]);
    expect(filesMatching(/\bclearSessionCookie\(/)).toEqual([
      "app/logout/route.ts",
      COOKIE_HELPERS,
    ]);
  });

  it("writes cookies nowhere but the two session cookie helpers", () => {
    expect(sourceFiles(webRoot).length).toBeGreaterThan(10);
    expect(filesMatching(COOKIE_WRITE)).toEqual([COOKIE_HELPERS]);
  });
});
