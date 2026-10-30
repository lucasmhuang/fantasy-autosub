import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";
import { TestDatabaseError } from "./errors";

// One constant, so CI can switch to a mirror if Docker Hub refuses the pull.
export const POSTGRES_IMAGE = "postgres:17-alpine";

// Every container the harness starts carries both labels. The second holds the test run's process
// id, so a later run can tell a leftover from an interrupted run from a live run's container.
const HARNESS_LABEL = "injurysub.test-db";
const OWNER_PID_LABEL = "injurysub.test-db.pid";

const IPV4_BINDING = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/;

export type DockerOutput = { stdout: string; stderr: string };
export type DockerRun = (args: readonly string[], options: { timeoutMs: number }) => DockerOutput;
export type TestPostgres = { id: string; adminUrl: string };

// Runs a docker command and returns both of its output streams: a Postgres container logs mostly to
// stderr. A non-zero exit, a signal, a binary that can't start, or the time limit throws.
export function dockerCommandRunner(binary: string): DockerRun {
  return (args, { timeoutMs }) => {
    const result = spawnSync(binary, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error === undefined && result.status === 0) {
      return { stdout: result.stdout, stderr: result.stderr };
    }
    const command = `docker ${args[0] ?? ""}`.trimEnd();
    throw new TestDatabaseError(
      "docker_command_failed",
      describeDockerFailure(command, result, timeoutMs),
      result.error ? { cause: result.error } : {}
    );
  };
}

export const runDocker: DockerRun = dockerCommandRunner("docker");

function describeDockerFailure(
  command: string,
  result: SpawnSyncReturns<string>,
  timeoutMs: number
): string {
  if (result.error) {
    const code = errorCode(result.error) ?? result.error.message;
    return code === "ETIMEDOUT"
      ? `${command} took longer than ${timeoutMs} ms (ETIMEDOUT)`
      : `${command} couldn't run (${code})`;
  }
  const outcome =
    result.status === null ? `was stopped by ${result.signal}` : `exited with ${result.status}`;
  const reason = lastLine(result.stderr);
  return reason === undefined ? `${command} ${outcome}` : `${command} ${outcome}: ${reason}`;
}

export function ensureDocker(run: DockerRun): void {
  try {
    run(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
  } catch (error) {
    if (!(error instanceof TestDatabaseError)) throw error;
    throw new TestDatabaseError(
      "docker_unavailable",
      `Database tests need Docker running. ${error.message}`,
      { cause: error }
    );
  }
}

// Starts a throwaway Postgres for one test run: trust authentication, so no password exists
// anywhere; a random port on 127.0.0.1 only; the data on tmpfs, with durability off for speed.
// There's no --rm, so a failed start's log can still be read.
export function startTestPostgres(run: DockerRun, { pid }: { pid: number }): TestPostgres {
  const id = runPostgresContainer(run, pid);
  try {
    const { stdout } = run(["port", id, "5432/tcp"], { timeoutMs: 10_000 });
    return { id, adminUrl: adminUrlFor(parsePublishedPort(stdout)) };
  } catch (error) {
    if (!(error instanceof TestDatabaseError)) throw error;
    throw failStart(run, id, error);
  }
}

function runPostgresContainer(run: DockerRun, pid: number): string {
  const args = [
    ...["run", "-d", "--label", `${HARNESS_LABEL}=1`, "--label", `${OWNER_PID_LABEL}=${pid}`],
    ...["-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-p", "127.0.0.1::5432"],
    ...["--tmpfs", "/var/lib/postgresql/data", POSTGRES_IMAGE],
    ...["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"],
  ];
  let stdout: string;
  try {
    // Long enough for a first pull of the image.
    stdout = run(args, { timeoutMs: 180_000 }).stdout;
  } catch (error) {
    if (!(error instanceof TestDatabaseError)) throw error;
    throw new TestDatabaseError(
      "container_failed",
      `The test Postgres server didn't start. ${error.message}`,
      { cause: error }
    );
  }
  const id = stdout.trim();
  if (id === "") {
    throw new TestDatabaseError("container_failed", "docker run gave no container id");
  }
  return id;
}

// TLS is off explicitly: when a URL names no sslmode, pg falls back to the shell's PGSSLMODE, and
// this server doesn't offer TLS.
function adminUrlFor(port: number): string {
  return `postgres://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
}

// The error for a server that didn't come up, with the last lines of its log; the server is removed.
// Trouble reading the log or removing the server is reported in the message, never in its place.
export function failStart(run: DockerRun, id: string, cause: Error): TestDatabaseError {
  const log = readLogTail(run, id);
  const leftover = removeAfterFailedStart(run, id);
  return new TestDatabaseError(
    "container_failed",
    `The test Postgres server didn't start: ${cause.message}${leftover}\nThe last lines of its log:\n${log}`,
    { cause }
  );
}

function readLogTail(run: DockerRun, id: string): string {
  try {
    const { stdout, stderr } = run(["logs", "--tail", "50", id], { timeoutMs: 10_000 });
    return [stdout.trimEnd(), stderr.trimEnd()].filter((part) => part !== "").join("\n");
  } catch (error) {
    if (!(error instanceof TestDatabaseError)) throw error;
    return `(its log couldn't be read: ${error.message})`;
  }
}

function removeAfterFailedStart(run: DockerRun, id: string): string {
  try {
    removeTestPostgres(run, id);
    return "";
  } catch (error) {
    if (!(error instanceof TestDatabaseError)) throw error;
    return `. It couldn't be removed either (${error.message}); remove it with docker rm -f ${id}`;
  }
}

// docker port answers one line per binding, such as 127.0.0.1:49153 or [::]:49153.
export function parsePublishedPort(output: string): number {
  const binding = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => IPV4_BINDING.test(line));
  const port = binding === undefined ? 0 : Number(binding.slice(binding.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new TestDatabaseError(
      "container_failed",
      `docker port gave no IPv4 port for the test server: ${JSON.stringify(output.slice(0, 200))}`
    );
  }
  return port;
}

// Each line of the listing is "<container id> <owner pid>". A container whose owner has exited, or
// whose owner can't be read, is left over from an interrupted run.
export function staleContainerIds(listing: string, isAlive: (pid: number) => boolean): string[] {
  return listing.split("\n").flatMap((line) => {
    const [id = "", owner] = line.trim().split(/\s+/);
    if (id === "") return [];
    const pid = Number(owner);
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? [] : [id];
  });
}

// Signal 0 tests that a process exists without touching it. EPERM means it exists but belongs to
// another user.
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error ? errorCode(error) : undefined;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

// Removes the containers of earlier runs that ended without their teardown (Ctrl-C, a crash, a
// power cut) and gives their ids. A live run's container stays, so concurrent runs don't collide.
export function sweepStaleTestPostgres(
  run: DockerRun,
  isAlive: (pid: number) => boolean
): string[] {
  const { stdout } = run(
    [
      ...["ps", "-a", "--filter", `label=${HARNESS_LABEL}`],
      ...["--format", `{{.ID}} {{.Label "${OWNER_PID_LABEL}"}}`],
    ],
    { timeoutMs: 10_000 }
  );
  const stale = staleContainerIds(stdout, isAlive);
  if (stale.length > 0) run(["rm", "-f", "-v", ...stale], { timeoutMs: 30_000 });
  return stale;
}

export function removeTestPostgres(run: DockerRun, id: string): void {
  run(["rm", "-f", "-v", id], { timeoutMs: 30_000 });
}

// Polls until the server answers a query. The image's first-start setup runs a server on its
// socket only, so an answer over TCP comes from the final server.
export async function waitUntilAccepting(adminUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    lastError = await queryOnce(adminUrl, Math.min(2_000, Math.max(1, deadline - Date.now())));
    if (lastError === undefined) return;
    await sleep(100);
  }
  const reason =
    lastError === undefined
      ? "no attempt was made"
      : `last error: ${errorCode(lastError) ?? lastError.message}`;
  throw new TestDatabaseError(
    "container_failed",
    `The test Postgres server didn't accept connections within ${timeoutMs} ms (${reason})`,
    lastError ? { cause: lastError } : {}
  );
}

// One connection and one query. The failure comes back as a value, so the caller can retry.
async function queryOnce(url: string, connectTimeoutMs: number): Promise<Error | undefined> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: connectTimeoutMs });
  // pg reports a connection lost after connecting as an `error` event, which crashes the process
  // when nothing listens for it.
  let lost: Error | undefined;
  client.on("error", (error) => {
    lost = error;
  });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error;
  } finally {
    await client.end();
  }
  return lost;
}

function errorCode(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function lastLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
}
