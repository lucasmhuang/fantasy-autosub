import { execFile } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const SCRIPT = new URL("./backup.sh", import.meta.url).pathname;

// Invented settings only. The password and the secret key must never reach the script's output.
const settings = {
  BACKUP_DATABASE_URL:
    "postgres://backup:invented-db-password@postgres.railway.internal:5432/railway?sslmode=require",
  BACKUP_AGE_RECIPIENT: "age1inventedrecipientkeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  BACKUP_BUCKET: "invented-bucket",
  BACKUP_S3_ENDPOINT: "https://storage.example.test",
  BACKUP_S3_REGION: "auto",
  BACKUP_S3_ACCESS_KEY_ID: "invented-access-key",
  BACKUP_S3_SECRET_ACCESS_KEY: "invented-secret-key",
};

let work: string;
let stubs: string;
let uploads: string;

// Stand-ins for pg_dump, age and curl, first on PATH: nothing real runs. Each leaves a mark when
// called; `fail` makes one exit 1.
function writeStubs(fail: "pg_dump" | "age" | "curl" | null = null) {
  const stub = (name: string, body: string) => {
    const path = join(stubs, name);
    const exit = fail === name ? "exit 1" : "";
    writeFileSync(
      path,
      `#!/usr/bin/env bash\nset -eu\ntouch "${work}/called-${name}"\n${exit}\n${body}\n`
    );
    chmodSync(path, 0o755);
  };
  // pg_dump --format=custom --file=<path> <url>: a custom-format dump starts PGDMP.
  stub(
    "pg_dump",
    'for arg in "$@"; do case "$arg" in --file=*) printf "PGDMP invented dump" > "${arg#--file=}";; esac; done'
  );
  // age -r <recipient> -o <out> <in>
  stub(
    "age",
    'out=""; in=""; while [ $# -gt 0 ]; do case "$1" in -r) shift;; -o) out="$2"; shift;; *) in="$1";; esac; shift; done; { printf "age-encryption.org/v1\\n"; cat "$in" | rev; } > "$out"'
  );
  // curl ... -T <file> <url>: keeps the uploaded file under the URL's last part.
  stub(
    "curl",
    `file=""; url=""; while [ $# -gt 0 ]; do case "$1" in -T) file="$2"; shift;; https://*) url="$1";; esac; shift; done; cp "$file" "${uploads}/\${url##*/}"`
  );
}

async function backup(env: Record<string, string>) {
  try {
    const { stdout, stderr } = await run("bash", [SCRIPT], {
      env: { PATH: `${stubs}:/usr/bin:/bin`, HOME: work, TMPDIR: work, ...env },
    });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, output: failed.stdout + failed.stderr };
  }
}

const called = (name: string) => readdirSync(work).includes(`called-${name}`);

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "injurysub-backup-"));
  stubs = join(work, "bin");
  uploads = join(work, "uploads");
  mkdirSync(stubs);
  mkdirSync(uploads);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("the nightly backup", () => {
  it("uploads one object, named by the UTC time, that is age's output and not the raw dump", async () => {
    writeStubs();

    const result = await backup(settings);

    expect(result.code).toBe(0);
    const objects = readdirSync(uploads);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.dump\.age$/);
    const uploaded = readFileSync(join(uploads, objects[0] ?? ""), "utf8");
    expect(uploaded.startsWith("age-encryption.org/v1")).toBe(true);
    expect(uploaded.startsWith("PGDMP")).toBe(false);
  });

  it.each([
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_BUCKET",
    "BACKUP_S3_ENDPOINT",
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY",
    "BACKUP_DATABASE_URL",
  ])("stops before any dump when %s isn't set, naming it", async (missing) => {
    writeStubs();
    const { [missing]: _left, ...rest } = settings as Record<string, string>;

    const result = await backup(rest);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain(missing);
    expect(called("pg_dump")).toBe(false);
  });

  it.each([
    "pg_dump",
    "age",
    "curl",
  ] as const)("exits non-zero with nothing uploaded when %s fails", async (failing) => {
    writeStubs(failing);

    const result = await backup(settings);

    expect(result.code).not.toBe(0);
    expect(readdirSync(uploads)).toEqual([]);
  });

  it("never prints the database password, the secret key or the recipient", async () => {
    writeStubs("curl");

    const result = await backup(settings);

    expect(result.output).not.toContain("invented-db-password");
    expect(result.output).not.toContain("invented-secret-key");
    expect(result.output).not.toContain(settings.BACKUP_AGE_RECIPIENT);
  });
});
