import { EspnError } from "./errors";

// ESPN's read host. These paths are the ones the read-only probes used (2026-10-23 and 10-24).
const READS_HOST = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba";
// ESPN's error bodies name a type such as AUTH_LEAGUE_NOT_VISIBLE; nothing else from them is kept.
const ESPN_ERROR_TYPE = /^[A-Z][A-Z_]{0,63}$/;

export const DEFAULT_READ_TIMEOUT_MS = 10_000;

export type EspnCredentials = { espnS2: string; swid: string };

export type EspnJsonRequest = {
  url: string;
  // What is being read, for error messages: views, team, scoring period. Never the league id.
  readName: string;
  season?: number;
  signal: AbortSignal;
  credentials?: EspnCredentials;
};

export function leagueViewUrl(
  season: number,
  leagueId: number,
  views: readonly string[],
  scoringPeriodId?: number
): string {
  const url = new URL(`${READS_HOST}/seasons/${season}/segments/0/leagues/${leagueId}`);
  for (const view of views) url.searchParams.append("view", view);
  if (scoringPeriodId !== undefined) {
    url.searchParams.set("scoringPeriodId", String(scoringPeriodId));
  }
  return url.toString();
}

export function proScheduleUrl(season: number): string {
  return `${READS_HOST}/seasons/${season}?view=proTeamSchedules_wl`;
}

export function gameRootUrl(): string {
  return READS_HOST;
}

// One deadline for a whole read: every request the read makes shares it, so the 10 s default is
// per read.
export function createReadDeadline(timeoutMs: number = DEFAULT_READ_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function requestHeaders(credentials: EspnCredentials | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (credentials) headers.Cookie = `espn_s2=${credentials.espnS2}; SWID=${credentials.swid}`;
  return headers;
}

function timedOut(request: EspnJsonRequest): EspnError {
  const reason: unknown = request.signal.reason;
  return new EspnError(
    "espn_unavailable",
    `ESPN unavailable: timed out reading ${request.readName}`,
    {
      cause: reason instanceof Error ? reason : new Error("the read's deadline passed"),
    }
  );
}

function connectionFailed(request: EspnJsonRequest, cause: TypeError): EspnError {
  return new EspnError(
    "espn_unavailable",
    `ESPN unavailable: the request failed reading ${request.readName}`,
    { cause }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(body: string): { parsed: unknown } | { syntaxError: SyntaxError } {
  try {
    return { parsed: JSON.parse(body) };
  } catch (error) {
    if (error instanceof SyntaxError) return { syntaxError: error };
    throw error;
  }
}

function espnErrorType(body: string): string | undefined {
  const result = parseJson(body);
  if (!("parsed" in result) || !isRecord(result.parsed)) return undefined;
  const details = result.parsed.details;
  const firstDetail: unknown = Array.isArray(details) ? details[0] : undefined;
  const type = isRecord(firstDetail) ? firstDetail.type : undefined;
  return typeof type === "string" && ESPN_ERROR_TYPE.test(type) ? type : undefined;
}

function httpError(status: number, body: string, request: EspnJsonRequest): EspnError {
  const type = espnErrorType(body);
  const cause = new Error(type ? `HTTP ${status} ${type}` : `HTTP ${status}`);
  if (status === 401) {
    return new EspnError(
      "credentials_rejected",
      `ESPN credentials need refreshing, or LEAGUE_ID isn't a league they can see (HTTP 401 reading ${request.readName})`,
      { status, cause }
    );
  }
  if (status === 404) {
    const season = request.season === undefined ? "" : ` for season ${request.season}`;
    return new EspnError(
      "league_not_found",
      `League not found: ESPN has no such league${season} (HTTP 404 reading ${request.readName})`,
      { status, cause }
    );
  }
  return new EspnError(
    "espn_unavailable",
    `ESPN unavailable: HTTP ${status} reading ${request.readName}`,
    { status, cause }
  );
}

// The characters a cookie value can carry (RFC 6265): no control characters, whitespace, quotes,
// commas, semicolons or backslashes. fetch refuses a header holding a line break with an error
// that quotes the whole header, cookies included, so credentials are checked before any request.
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

function cookieSafe(credentials: EspnCredentials): boolean {
  return COOKIE_VALUE.test(credentials.espnS2) && COOKIE_VALUE.test(credentials.swid);
}

// Throws, naming neither value, when the credentials can't be sent as cookies. The live source
// calls it before its first request, the season check's included; readEspnJson calls it as well.
export function confirmSendableCredentials(credentials: EspnCredentials, readName: string): void {
  if (cookieSafe(credentials)) return;
  throw new EspnError(
    "credentials_rejected",
    `ESPN credentials can't be sent: ESPN_S2 or ESPN_SWID holds a character a cookie can't carry, such as a space or a line break (reading ${readName})`
  );
}

// One GET, classified: a failure always throws an EspnError whose message names the read but never
// the URL (it holds the league id) or the cookies. Its cause is an Error, except for credentials
// refused before the request, which carry none.
export async function readEspnJson(request: EspnJsonRequest): Promise<unknown> {
  if (request.credentials) confirmSendableCredentials(request.credentials, request.readName);
  let response: Response;
  let body: string;
  try {
    response = await fetch(request.url, {
      headers: requestHeaders(request.credentials),
      signal: request.signal,
    });
    body = await response.text();
  } catch (error) {
    if (request.signal.aborted) throw timedOut(request);
    // fetch reports a failed connection, or a body cut off midway, as a TypeError.
    if (error instanceof TypeError) throw connectionFailed(request, error);
    throw error;
  }
  if (!response.ok) throw httpError(response.status, body, request);
  const result = parseJson(body);
  if ("parsed" in result) return result.parsed;
  throw new EspnError(
    "unrecognized_response",
    `ESPN sent a response that isn't JSON (reading ${request.readName})`,
    { status: response.status, cause: result.syntaxError }
  );
}
