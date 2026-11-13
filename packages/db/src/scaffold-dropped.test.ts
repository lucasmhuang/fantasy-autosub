import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// The scaffold 0006 drops: its tables, their drizzle names, and the domain modules beside them.
const DROPPED_NAMES =
  /substitution_requests|substitution_events|team_execution_leases|substitutionRequests|substitutionEvents|teamExecutionLeases|substitutionRequestStatuses|schema\/substitutions|substitutions\/request-status|execution\/modes|\bexecutionModes\b/;
const SKIPPED = new Set(["node_modules", ".next", "drizzle", "recordings", "scenarios"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

describe("the scaffold that migration 0006 drops", () => {
  it("is named by no source file but the tests that check its drop", () => {
    const naming = ["apps", "packages"]
      .flatMap((top) => sourceFiles(join(repoRoot, top)))
      .filter((path) => !/migration-0006|scaffold-dropped/.test(path))
      .filter((path) => DROPPED_NAMES.test(readFileSync(path, "utf8")))
      .map((path) => relative(repoRoot, path));

    expect(naming).toEqual([]);
  });
});
