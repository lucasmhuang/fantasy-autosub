import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type DockerOutput,
  type DockerRun,
  dockerCommandRunner,
  ensureDocker,
  isProcessAlive,
  parsePublishedPort,
  removeTestPostgres,
  staleContainerIds,
  startTestPostgres,
  sweepStaleTestPostgres,
  waitUntilAccepting,
} from "./container";
import { TestDatabaseError } from "./errors";

const containerId = "4f3c2b1a0e9d";

type DockerCall = { args: readonly string[]; timeoutMs: number };

// A fake docker CLI: answers each subcommand (`run`, `port`, `logs`, ...) from a table, and records
// every call. A subcommand missing from the table succeeds with no output.
function fakeDocker(answers: Record<string, Partial<DockerOutput> | TestDatabaseError>) {
  const calls: DockerCall[] = [];
  const run: DockerRun = (args, { timeoutMs }) => {
    calls.push({ args, timeoutMs });
    const answer = answers[args[0] ?? ""] ?? {};
    if (answer instanceof TestDatabaseError) throw answer;
    return { stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
  };
  return { run, calls, subcommands: () => calls.map((call) => call.args[0]) };
}

// What the real runner throws when a docker command exits with an error.
function dockerFailure(subcommand: string, stderr: string) {
  return new TestDatabaseError(
    "docker_command_failed",
    `docker ${subcommand} exited with 1: ${stderr}`
  );
}

// The values that follow `flag` in a docker argument list: `--label a --label b` gives [a, b].
function valuesOf(args: readonly string[] | undefined, flag: string): string[] {
  const values: string[] = [];
  (args ?? []).forEach((arg, index) => {
    const value = args?.[index + 1];
    if (arg === flag && value !== undefined) values.push(value);
  });
  return values;
}

function failureOf(call: () => unknown): TestDatabaseError {
  try {
    call();
  } catch (error) {
    if (error instanceof TestDatabaseError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

async function rejectionOf(promise: Promise<unknown>): Promise<TestDatabaseError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TestDatabaseError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("dockerCommandRunner", () => {
  let scriptDir = "";
  let fakeBinary = "";

  // A stand-in docker binary. `exec` makes `sleep` the process the time limit stops.
  beforeAll(() => {
    scriptDir = mkdtempSync(join(tmpdir(), "test-db-docker-"));
    fakeBinary = join(scriptDir, "docker");
    writeFileSync(
      fakeBinary,
      [
        "#!/bin/sh",
        'case "$1" in',
        '  ok) echo "on stdout"; echo "on stderr" >&2 ;;',
        '  fail) echo "progress line" >&2; echo "Error response from daemon: No such container: x" >&2; exit 1 ;;',
        "  killed) kill -9 $$ ;;",
        "  hang) exec sleep 10 ;;",
        "esac",
        "",
      ].join("\n")
    );
    chmodSync(fakeBinary, 0o755);
  });

  afterAll(() => {
    rmSync(scriptDir, { recursive: true, force: true });
  });

  it("returns both of a command's output streams", () => {
    expect(dockerCommandRunner(fakeBinary)(["ok"], { timeoutMs: 5_000 })).toEqual({
      stdout: "on stdout\n",
      stderr: "on stderr\n",
    });
  });

  it("names the subcommand, its exit status and docker's last error line when it fails", () => {
    const error = failureOf(() => dockerCommandRunner(fakeBinary)(["fail"], { timeoutMs: 5_000 }));

    expect(error.code).toBe("docker_command_failed");
    expect(error.message).toContain("docker fail exited with 1");
    expect(error.message).toContain("Error response from daemon: No such container: x");
    expect(error.message).not.toContain("progress line");
  });

  it("names the signal that stopped a command", () => {
    const error = failureOf(() =>
      dockerCommandRunner(fakeBinary)(["killed"], { timeoutMs: 5_000 })
    );

    expect(error.code).toBe("docker_command_failed");
    expect(error.message).toContain("docker killed was stopped by SIGKILL");
  });

  it("stops a command at its time limit", () => {
    const started = Date.now();
    const error = failureOf(() => dockerCommandRunner(fakeBinary)(["hang"], { timeoutMs: 200 }));

    expect(error.code).toBe("docker_command_failed");
    expect(error.message).toContain("ETIMEDOUT");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("says when the docker binary can't be run", () => {
    const missing = join(scriptDir, "missing");
    const error = failureOf(() => dockerCommandRunner(missing)(["version"], { timeoutMs: 5_000 }));

    expect(error.code).toBe("docker_command_failed");
    expect(error.message).toContain("ENOENT");
  });
});

describe("ensureDocker", () => {
  it("passes when docker answers", () => {
    const docker = fakeDocker({ version: { stdout: "29.1.3\n" } });

    expect(() => ensureDocker(docker.run)).not.toThrow();
  });

  it("says database tests need Docker running, with docker's reason, when it doesn't answer", () => {
    const docker = fakeDocker({
      version: dockerFailure(
        "version",
        "Cannot connect to the Docker daemon at unix:///nonexistent."
      ),
    });

    const error = failureOf(() => ensureDocker(docker.run));

    expect(error.code).toBe("docker_unavailable");
    expect(error.message).toContain("Database tests need Docker running");
    expect(error.message).toContain("Cannot connect to the Docker daemon at unix:///nonexistent.");
  });
});

describe("startTestPostgres", () => {
  it("starts a labelled, password-free server on a random loopback port", () => {
    const docker = fakeDocker({
      run: { stdout: `${containerId}\n` },
      port: { stdout: "127.0.0.1:49153\n" },
    });

    const server = startTestPostgres(docker.run, { pid: 4321 });

    // The URL crosses from the global setup to the test workers, where pg reads its sslmode. Without
    // it, a PGSSLMODE in the shell would ask the test server for TLS, which it doesn't offer.
    expect(server).toEqual({
      id: containerId,
      adminUrl: "postgres://postgres@127.0.0.1:49153/postgres?sslmode=disable",
    });
    const runArgs = docker.calls[0]?.args;
    expect(runArgs?.slice(0, 2)).toEqual(["run", "-d"]);
    expect(valuesOf(runArgs, "--label")).toEqual([
      "injurysub.test-db=1",
      "injurysub.test-db.pid=4321",
    ]);
    expect(valuesOf(runArgs, "-e")).toEqual(["POSTGRES_HOST_AUTH_METHOD=trust"]);
    expect(valuesOf(runArgs, "-p")).toEqual(["127.0.0.1::5432"]);
    expect(valuesOf(runArgs, "--tmpfs")).toEqual(["/var/lib/postgresql/data"]);
    expect(runArgs).toContain("postgres:17-alpine");
  });

  it("puts the server's last log lines in the error when it doesn't come up, then removes it", () => {
    const docker = fakeDocker({
      run: { stdout: `${containerId}\n` },
      port: { stdout: "" },
      logs: {
        stdout: "PostgreSQL init process complete; ready for start up.\n",
        stderr: "FATAL:  could not create shared memory segment\n",
      },
    });

    const error = failureOf(() => startTestPostgres(docker.run, { pid: 4321 }));

    expect(error.code).toBe("container_failed");
    expect(error.message).toContain("PostgreSQL init process complete; ready for start up.");
    expect(error.message).toContain("FATAL:  could not create shared memory segment");
    expect(docker.subcommands()).toEqual(["run", "port", "logs", "rm"]);
    expect(valuesOf(docker.calls[2]?.args, "--tail")).toEqual(["50"]);
    expect(docker.calls[3]?.args).toEqual(["rm", "-f", "-v", containerId]);
  });

  it("still says why the server didn't start when its log can't be read or it won't go", () => {
    const docker = fakeDocker({
      run: { stdout: `${containerId}\n` },
      port: { stdout: "" },
      logs: dockerFailure("logs", "Error response from daemon: can not get logs"),
      rm: dockerFailure("rm", "Error response from daemon: removal in progress"),
    });

    const error = failureOf(() => startTestPostgres(docker.run, { pid: 4321 }));

    expect(error.code).toBe("container_failed");
    expect(error.message).toContain("docker port gave no IPv4 port");
    expect(error.message).toContain("its log couldn't be read");
    expect(error.message).toContain(`remove it with docker rm -f ${containerId}`);
  });

  it("says the server didn't start, with docker's reason, when docker can't run it", () => {
    const docker = fakeDocker({
      run: dockerFailure("run", "toomanyrequests: You have reached your pull rate limit."),
    });

    const error = failureOf(() => startTestPostgres(docker.run, { pid: 4321 }));

    expect(error.code).toBe("container_failed");
    expect(error.message).toContain("toomanyrequests: You have reached your pull rate limit.");
    expect(docker.subcommands()).toEqual(["run"]);
  });
});

describe("parsePublishedPort", () => {
  it("reads the port from docker's answer for a loopback binding", () => {
    expect(parsePublishedPort("127.0.0.1:49153\n")).toBe(49153);
  });

  it("takes the IPv4 line when docker also lists an IPv6 one", () => {
    expect(parsePublishedPort("[::]:49155\n0.0.0.0:49155\n")).toBe(49155);
  });

  it.each([
    "",
    "\n",
    "no such port",
    "127.0.0.1:",
    "127.0.0.1:port",
  ])("refuses an answer with no IPv4 port: %j", (answer) => {
    expect(failureOf(() => parsePublishedPort(answer)).code).toBe("container_failed");
  });
});

describe("staleContainerIds", () => {
  it("returns the containers whose test run has ended, and keeps the live runs' ones", () => {
    const listing = `aaa111 ${process.pid}\nbbb222 202\nccc333 303\n`;
    const livePids = new Set([process.pid, 303]);

    expect(staleContainerIds(listing, (pid) => livePids.has(pid))).toEqual(["bbb222"]);
  });

  it("counts a container whose owner can't be read as stale", () => {
    expect(staleContainerIds("ddd444 \neee555 not-a-pid\n", () => true)).toEqual([
      "ddd444",
      "eee555",
    ]);
  });
});

describe("isProcessAlive", () => {
  it("counts its own process and one it may not signal as alive, and an impossible id as dead", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(1)).toBe(true);
    // Linux's pid_max can't exceed 4 194 304, so no process ever has this id.
    expect(isProcessAlive(4_194_305)).toBe(false);
  });
});

describe("sweepStaleTestPostgres", () => {
  it("lists the harness's containers with their owners, and removes those of ended runs", () => {
    const docker = fakeDocker({ ps: { stdout: `aaa111 ${process.pid}\nbbb222 202\n` } });

    const removed = sweepStaleTestPostgres(docker.run, (pid) => pid === process.pid);

    expect(removed).toEqual(["bbb222"]);
    expect(valuesOf(docker.calls[0]?.args, "--filter")).toEqual(["label=injurysub.test-db"]);
    expect(valuesOf(docker.calls[0]?.args, "--format")).toEqual([
      '{{.ID}} {{.Label "injurysub.test-db.pid"}}',
    ]);
    expect(docker.calls[1]?.args).toEqual(["rm", "-f", "-v", "bbb222"]);
  });

  it("removes nothing when every run is live", () => {
    const docker = fakeDocker({ ps: { stdout: `aaa111 ${process.pid}\n` } });

    expect(sweepStaleTestPostgres(docker.run, () => true)).toEqual([]);
    expect(docker.subcommands()).toEqual(["ps"]);
  });
});

describe("docker calls", () => {
  it("each carry a time limit, and none holds a password", () => {
    const docker = fakeDocker({
      ps: { stdout: "bbb222 202\n" },
      run: { stdout: `${containerId}\n` },
      port: { stdout: "" },
    });

    ensureDocker(docker.run);
    sweepStaleTestPostgres(docker.run, () => false);
    failureOf(() => startTestPostgres(docker.run, { pid: 4321 }));
    removeTestPostgres(docker.run, containerId);

    expect(docker.subcommands()).toEqual([
      "version",
      "ps",
      "rm",
      "run",
      "port",
      "logs",
      "rm",
      "rm",
    ]);
    for (const call of docker.calls) {
      expect(call.timeoutMs).toBeGreaterThan(0);
      expect(call.timeoutMs).toBeLessThan(Number.POSITIVE_INFINITY);
      expect(call.args.join(" ")).not.toMatch(/PASSWORD=/i);
    }
  });
});

describe("waitUntilAccepting", () => {
  const servers: Server[] = [];

  // A local stand-in for the test server, and its URL.
  async function serveLocally(onConnection: (socket: Socket) => void): Promise<string> {
    const server = createServer(onConnection);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP address");
    return `postgres://postgres@127.0.0.1:${address.port}/postgres?sslmode=disable`;
  }

  afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it("gives up at its time limit, naming the last connection error", async () => {
    // Closes each connection after pg's first message, as docker's port proxy does while Postgres
    // isn't listening yet. Reading first makes the close clean, never a reset.
    const url = await serveLocally((socket) => {
      socket.once("data", () => socket.end());
    });
    const started = Date.now();

    const error = await rejectionOf(waitUntilAccepting(url, 300));

    expect(error.code).toBe("container_failed");
    expect(error.message).toContain("within 300 ms");
    expect(error.message).toContain("Connection terminated unexpectedly");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("keeps waiting, without crashing, when a server drops the connection after the handshake", async () => {
    // Answers pg's startup with AuthenticationOk and ReadyForQuery, then closes on the query. pg
    // reports that loss as an `error` event too, which would crash the run if nothing listened.
    const url = await serveLocally((socket) => {
      socket.once("data", () => {
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
        socket.once("data", () => socket.end());
      });
    });

    const error = await rejectionOf(waitUntilAccepting(url, 300));

    expect(error.code).toBe("container_failed");
    expect(error.message).toContain("Connection terminated unexpectedly");
  });
});
