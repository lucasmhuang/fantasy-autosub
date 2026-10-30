import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const manifest: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

describe("worker scripts", () => {
  let repoRoot = "";

  // A stand-in repo root, so the scripts' ../../ paths resolve to these files instead of the real ones.
  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "worker-env-files-"));
    mkdirSync(join(repoRoot, "apps", "worker"), { recursive: true });
    writeFileSync(join(repoRoot, ".env"), "PRECEDENCE_PROBE=from-env\n");
    writeFileSync(join(repoRoot, ".env.local"), "PRECEDENCE_PROBE=from-env-local\n");
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it.each(["dev", "start", "seed:accounts"])("%s lets .env.local override .env", (scriptName) => {
    const envFileFlags = manifest.scripts[scriptName]?.match(/--env-file-if-exists=\S+/g) ?? [];

    const value = execFileSync(
      process.execPath,
      [...envFileFlags, "--print", "process.env.PRECEDENCE_PROBE"],
      { cwd: join(repoRoot, "apps", "worker"), env: {}, encoding: "utf8" }
    );

    expect(value.trim()).toBe("from-env-local");
  });
});
