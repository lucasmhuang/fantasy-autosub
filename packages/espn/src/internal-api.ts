import { z } from "zod";
import type { EspnReadClient, TeamWeekRead } from "./read/contracts";
import { EspnError, isEspnErrorCode } from "./read/errors";

// The worker's internal read API, shared by the worker (which serves it) and the web (which calls
// it), so the two sides can't drift. Only reads: the API has no write path.
export const INTERNAL_READS = {
  getTeamWeek: {
    path: "/internal/espn/team-week",
    args: z.object({ teamId: z.number().int().positive() }),
  },
} as const;
export type InternalReadName = keyof typeof INTERNAL_READS;

// Every answer: the read's result, or the EspnError code it failed with (or a fixed code).
export const internalReadAnswerSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.string() }),
]);
export type InternalReadAnswer = z.infer<typeof internalReadAnswerSchema>;

export type InternalReadClient = Pick<EspnReadClient, InternalReadName>;

// Longer than the worker's 10 s read deadline, so a slow ESPN read fails as ESPN's, not as this.
const DEFAULT_PROXY_TIMEOUT_MS = 12_000;

// The web's ESPN reads: each asks the worker over its internal API. A worker that can't be
// reached, refuses the token, or answers something else fails as worker_unreachable; an ESPN
// failure keeps its code.
export function createInternalReadClient(options: {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): InternalReadClient {
  const ask = (name: InternalReadName, args: unknown) => askWorker(options, name, args);
  return {
    // The worker sends the read's own result, so it is the read's type.
    getTeamWeek: async (teamId) => (await ask("getTeamWeek", { teamId })) as TeamWeekRead,
  };
}

async function askWorker(
  options: Parameters<typeof createInternalReadClient>[0],
  name: InternalReadName,
  args: unknown
): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const unreachable = (detail: string, cause?: Error) =>
    new EspnError("worker_unreachable", `the worker ${detail} (reading ${name})`, { cause });
  let body: unknown;
  try {
    const response = await doFetch(new URL(INTERNAL_READS[name].path, options.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS),
    });
    body = await response.json();
  } catch (error) {
    if (!isUnanswered(error)) throw error;
    throw unreachable("didn't answer", error);
  }
  const answer = internalReadAnswerSchema.safeParse(body);
  if (!answer.success) throw unreachable("answered something unrecognized");
  if (answer.data.ok) return answer.data.result;
  const { code } = answer.data;
  if (!isEspnErrorCode(code)) throw unreachable(`refused the read (${code})`);
  throw new EspnError(code, `the worker's read failed with ${code} (reading ${name})`);
}

// fetch fails with a TypeError when it can't connect, a TimeoutError past the deadline; a body
// that isn't JSON fails with a SyntaxError.
function isUnanswered(error: unknown): error is Error {
  if (error instanceof TypeError || error instanceof SyntaxError) return true;
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
