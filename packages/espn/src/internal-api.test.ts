import { describe, expect, it } from "vitest";
import { createInternalReadClient } from "./internal-api";
import type { TeamWeekRead } from "./read/contracts";
import { EspnError } from "./read/errors";

const token = "t".repeat(64);
const teamWeek = { teamId: 1, invented: "a team week" } as unknown as TeamWeekRead;

type Sent = { url: string; authorization: string | null; body: unknown };

// A worker answering every read with `answer`, keeping what was sent.
function workerAnswering(answer: () => Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return answer();
  };
  return { sent, fetch };
}

function clientFor(fetch: typeof globalThis.fetch) {
  return createInternalReadClient({ baseUrl: "http://worker.internal.example:3001", token, fetch });
}

async function rejectionOf(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

describe("createInternalReadClient", () => {
  it("asks the worker's read path with the token and the arguments, and gives its result", async () => {
    const worker = workerAnswering(async () => Response.json({ ok: true, result: teamWeek }));

    expect(await clientFor(worker.fetch).getTeamWeek(1)).toEqual(teamWeek);
    expect(worker.sent).toEqual([
      {
        url: "http://worker.internal.example:3001/internal/espn/team-week",
        authorization: `Bearer ${token}`,
        body: { teamId: 1 },
      },
    ]);
  });

  it("rejects with the ESPN code the worker answers", async () => {
    const worker = workerAnswering(async () =>
      Response.json({ ok: false, code: "credentials_rejected" }, { status: 502 })
    );

    expect((await rejectionOf(clientFor(worker.fetch).getTeamWeek(1))).code).toBe(
      "credentials_rejected"
    );
  });

  it("rejects as worker_unreachable when the worker can't be reached or refuses the token", async () => {
    const unreachable = workerAnswering(async () => {
      throw new TypeError("fetch failed");
    });
    const refused = workerAnswering(async () =>
      Response.json({ ok: false, code: "unauthorized" }, { status: 401 })
    );
    const garbled = workerAnswering(
      async () => new Response("<html>gateway</html>", { status: 502 })
    );

    for (const worker of [unreachable, refused, garbled]) {
      expect((await rejectionOf(clientFor(worker.fetch).getTeamWeek(1))).code).toBe(
        "worker_unreachable"
      );
    }
  });

  it("asks the worker's status path with the token, and gives its send mode", async () => {
    const worker = workerAnswering(async () =>
      Response.json({ ok: true, result: { sendMode: "never" } })
    );

    expect(await clientFor(worker.fetch).getWorkerStatus()).toEqual({ sendMode: "never" });
    expect(worker.sent).toEqual([
      {
        url: "http://worker.internal.example:3001/internal/worker/status",
        authorization: `Bearer ${token}`,
        body: {},
      },
    ]);
  });

  // An older worker answers 404 for the path; a status of another shape is no status either.
  it.each([
    ["a worker without the status path", { ok: false, code: "not_found" }, 404],
    ["a send mode it doesn't know", { ok: true, result: { sendMode: "sometimes" } }, 200],
  ] as const)("rejects as worker_unreachable for %s", async (_name, body, status) => {
    const worker = workerAnswering(async () => Response.json(body, { status }));

    expect((await rejectionOf(clientFor(worker.fetch).getWorkerStatus())).code).toBe(
      "worker_unreachable"
    );
  });
});
