import type { z } from "zod";
import { EspnError } from "./errors";
import {
  confirmSendableCredentials,
  type EspnCredentials,
  gameRootUrl,
  leagueViewUrl,
  proScheduleUrl,
  readEspnJson,
} from "./request";
import { createSeasonCheck } from "./season";

// The one seam between the reads and where their data comes from: live ESPN, a recording being
// made of live ESPN, or the committed recordings. Every read goes through it, so the recorded
// league exercises the same parsers as the live one.

export type EspnRequestKind = "league" | "pro-schedule" | "game";

export type EspnSourceRequest = {
  kind: EspnRequestKind;
  views: readonly string[];
  scoringPeriodId?: number;
  // What the read is, for error messages. Never the league id.
  readName: string;
  signal: AbortSignal;
  // The schema the read parses the answer with. The capture trims a recording to it.
  responseSchema?: z.ZodType;
};

// A recorded answer carries its capture time; a live one doesn't.
export type EspnSourceResponse = { body: unknown; capturedAt?: string };

export type EspnSource = (request: EspnSourceRequest) => Promise<EspnSourceResponse>;

// The committed recordings, merged: request key → body.
export type Recordings = {
  capturedAt: string;
  season: number;
  responses: ReadonlyMap<string, unknown>;
};

export type RecordedRequest = {
  kind: EspnRequestKind;
  views: readonly string[];
  scoringPeriodId?: number;
  responseSchema?: z.ZodType;
  body: unknown;
};

export type CreateLiveSourceOptions = {
  season: number;
  leagueId: number;
  credentials: EspnCredentials;
};

// A request's key in recordings: its kind, its views in sorted order, and its scoring period.
export function requestKey(
  request: Pick<EspnSourceRequest, "kind" | "views" | "scoringPeriodId">
): string {
  const views = [...request.views].sort().join(",");
  const period = request.scoringPeriodId === undefined ? "" : `@${request.scoringPeriodId}`;
  return `${request.kind}${views ? `:${views}` : ""}${period}`;
}

// Reads from ESPN. League and pro-schedule reads first confirm that the configured season is the
// one in progress (once per source, FM3); the game root needs no confirmation.
export function createLiveSource(options: CreateLiveSourceOptions): EspnSource {
  const checkSeason = createSeasonCheck(options.season, (signal) =>
    readEspnJson({ url: gameRootUrl(), readName: "the game root", signal })
  );
  const urlFor = (request: EspnSourceRequest) => {
    if (request.kind === "game") return gameRootUrl();
    if (request.kind === "pro-schedule") return proScheduleUrl(options.season);
    return leagueViewUrl(options.season, options.leagueId, request.views, request.scoringPeriodId);
  };

  return async (request) => {
    // Before the season check: its request sends no cookies, so an ESPN failure there would hide
    // unsendable ones.
    confirmSendableCredentials(options.credentials, request.readName);
    if (request.kind !== "game") await checkSeason(request.signal);
    const body = await readEspnJson({
      url: urlFor(request),
      readName: request.readName,
      season: options.season,
      signal: request.signal,
      credentials: options.credentials,
    });
    return { body };
  };
}

// Answers only the exact requests the recording holds, so a read that leaves out a view it needs
// fails in tests (FS4), and never from a different recorded read. Answers are copies.
export function createRecordedSource(loadRecordings: () => Promise<Recordings>): EspnSource {
  let loading: Promise<Recordings> | undefined;

  return async (request) => {
    loading ??= loadRecordings();
    const recordings = await loading;
    const key = requestKey(request);
    if (!recordings.responses.has(key)) {
      throw new EspnError(
        "not_recorded",
        `the recorded league doesn't hold ${key} (reading ${request.readName})`
      );
    }
    return {
      body: structuredClone(recordings.responses.get(key)),
      capturedAt: recordings.capturedAt,
    };
  };
}

// For the capture: passes each request on, and keeps its raw body under its key.
export function createRecordingSource(inner: EspnSource): {
  source: EspnSource;
  recorded: () => ReadonlyMap<string, RecordedRequest>;
} {
  const recorded = new Map<string, RecordedRequest>();

  return {
    source: async (request) => {
      const response = await inner(request);
      recorded.set(requestKey(request), {
        kind: request.kind,
        views: request.views,
        ...(request.scoringPeriodId === undefined
          ? {}
          : { scoringPeriodId: request.scoringPeriodId }),
        ...(request.responseSchema === undefined ? {} : { responseSchema: request.responseSchema }),
        body: response.body,
      });
      return response;
    },
    recorded: () => recorded,
  };
}
