import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ENTRIES = fileURLToPath(new URL("../emails/", import.meta.url));

// Vitest compiles JSX with its own settings, so a component that renders here can still fail where
// the worker runs it: `node --import tsx` from the repo root, which reads no tsconfig there and
// compiles JSX the classic way unless a file asks otherwise (the R7f-0 spike).
describe("the emails under the worker's runtime", () => {
  it("renders every preview entry with node --import tsx from the repo root in production", () => {
    const entries = readdirSync(ENTRIES).filter((file) => file.endsWith(".tsx"));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "packages/email/src/runtime-check.ts", ENTRIES],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 60_000,
      }
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toEqual({ rendered: entries.length });
  });
});
