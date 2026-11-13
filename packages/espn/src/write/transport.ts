import { EspnError } from "../read/errors";
import {
  cookieHeader,
  cookieSafe,
  type EspnCredentials,
  espnErrorType,
  parseJson,
} from "../read/request";

// ESPN's write host, as the 2026-10-29 league-manager writes used it.
const WRITES_HOST = "https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba";

export const DEFAULT_WRITE_TIMEOUT_MS = 15_000;

// Connection failures that happen before a request leaves this machine, so nothing reached ESPN.
// Any other failure once fetch has started may come after ESPN received the write.
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

// ESPN's answers that say it didn't process the write: busy, or limiting this client.
const DECLINED_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export type EspnWritePath = "transactions/" | "schedule";

export type EspnWriteRequest = {
  season: number;
  leagueId: number;
  path: EspnWritePath;
  // What is being written, for error messages: a team's lineup, a matchup. Never the league id.
  writeName: string;
  body: unknown;
  credentials: EspnCredentials;
  signal: AbortSignal;
};

export function createWriteDeadline(timeoutMs: number = DEFAULT_WRITE_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function writeUrl(request: EspnWriteRequest): string {
  return `${WRITES_HOST}/seasons/${request.season}/segments/0/leagues/${request.leagueId}/${request.path}`;
}

// The headers ESPN's own league-manager page sends with a write.
function writeHeaders(credentials: EspnCredentials): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Cookie: cookieHeader(credentials),
    "X-Fantasy-Source": "kona",
    "X-Fantasy-Platform": "espn-fantasy-web",
  };
}

function outcomeUnknown(
  request: EspnWriteRequest,
  what: string,
  options: { status?: number; cause: Error }
): EspnError {
  return new EspnError(
    "outcome_unknown",
    `ESPN's answer was lost writing ${request.writeName} (${what}): it may have applied, and only a read of ESPN can tell`,
    options
  );
}

function socketCode(error: TypeError): string | undefined {
  const cause: unknown = error.cause;
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

function connectionFailed(request: EspnWriteRequest, error: TypeError): EspnError {
  const code = socketCode(error);
  if (code !== undefined && NOT_SENT_CODES.has(code)) {
    return new EspnError(
      "espn_unavailable",
      `ESPN unavailable: couldn't connect writing ${request.writeName}, so nothing was sent`,
      { cause: error }
    );
  }
  return outcomeUnknown(request, "the connection dropped", { cause: error });
}

function cutOff(request: EspnWriteRequest): EspnError {
  const reason: unknown = request.signal.reason;
  return outcomeUnknown(request, "no answer before its deadline", {
    cause: reason instanceof Error ? reason : new Error("the write's deadline passed"),
  });
}

function httpWriteError(status: number, body: string, request: EspnWriteRequest): EspnError {
  const type = espnErrorType(body);
  const cause = new Error(type ? `HTTP ${status} ${type}` : `HTTP ${status}`);
  if (status === 401) {
    return new EspnError(
      "credentials_rejected",
      `ESPN credentials need refreshing, or LEAGUE_ID isn't a league they can see (HTTP 401 writing ${request.writeName})`,
      { status, cause }
    );
  }
  if (status === 404) {
    return new EspnError(
      "league_not_found",
      `League not found: ESPN has no such league for season ${request.season} (HTTP 404 writing ${request.writeName})`,
      { status, cause }
    );
  }
  if (DECLINED_STATUSES.has(status)) {
    return new EspnError(
      "espn_unavailable",
      `ESPN unavailable: HTTP ${status} writing ${request.writeName}`,
      { status, cause }
    );
  }
  if (status >= 400 && status < 500) {
    return new EspnError(
      "write_refused",
      `ESPN refused the write (HTTP ${status} writing ${request.writeName})`,
      { status, cause }
    );
  }
  return outcomeUnknown(request, `HTTP ${status}`, { status, cause });
}

function refuseUnsendableCredentials(request: EspnWriteRequest): void {
  if (cookieSafe(request.credentials)) return;
  throw new EspnError(
    "credentials_rejected",
    `ESPN credentials can't be sent: ESPN_S2 or ESPN_SWID holds a character a cookie can't carry, such as a space or a line break (writing ${request.writeName})`
  );
}

// One league-manager write, classified: a failure always throws an EspnError whose code says
// whether the write reached ESPN (write_refused, credentials_rejected, league_not_found: it
// didn't apply; espn_unavailable: it wasn't processed; outcome_unknown: read ESPN to find out).
// Messages name the write, never the URL (it holds the league id) or the cookies. ESPN's answer
// is never proof that the write applied: callers confirm every write with a read.
export async function postEspnJson(request: EspnWriteRequest): Promise<unknown> {
  refuseUnsendableCredentials(request);
  let response: Response;
  let body: string;
  try {
    response = await fetch(writeUrl(request), {
      method: "POST",
      headers: writeHeaders(request.credentials),
      body: JSON.stringify(request.body),
      signal: request.signal,
    });
    body = await response.text();
  } catch (error) {
    if (request.signal.aborted) throw cutOff(request);
    // fetch reports a failed connection, or a body cut off midway, as a TypeError.
    if (error instanceof TypeError) throw connectionFailed(request, error);
    throw error;
  }
  if (!response.ok) throw httpWriteError(response.status, body, request);
  const result = parseJson(body);
  if ("parsed" in result) return result.parsed;
  throw outcomeUnknown(request, "an answer that isn't JSON", {
    status: response.status,
    cause: result.syntaxError,
  });
}
