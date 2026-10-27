import { createReadClient } from "./read/client";
import type { EspnReadClient } from "./read/contracts";
import { loadCommittedRecordings } from "./read/recordings";
import { createLiveSource, createRecordedSource, type Recordings } from "./read/source";
import type { EspnWriteClient, RosterExecutionStep } from "./write/contracts";

export type EspnMode = "stub" | "live";

export type EspnReadOnlyClient = EspnReadClient & { mode: EspnMode };

export type EspnClient = EspnReadClient &
  EspnWriteClient & {
    mode: EspnMode;
  };

export type CreateStubEspnClientOptions = {
  recordings?: () => Promise<Recordings>;
};

export type CreateLiveEspnClientOptions = {
  espnS2: string;
  espnSwid: string;
  leagueId: number;
  seasonYear: number;
};

export type CreateEspnClientOptions =
  | ({ mode: "stub" } & CreateStubEspnClientOptions)
  | ({ mode: "live" } & CreateLiveEspnClientOptions);

// Reads only, in either mode, for code that must never write to ESPN: only the worker writes.
export function createEspnReadClient(options: CreateEspnClientOptions): EspnReadOnlyClient {
  if (options.mode === "stub") {
    return {
      mode: "stub",
      ...createReadClient(createRecordedSource(options.recordings ?? loadCommittedRecordings)),
      // The recorded league needs no credentials.
      checkCredentials: async () => ({ ok: true, source: "recorded" }),
    };
  }

  return {
    mode: "live",
    ...createReadClient(
      createLiveSource({
        season: options.seasonYear,
        leagueId: options.leagueId,
        credentials: { espnS2: options.espnS2, swid: options.espnSwid },
      }),
      { ownerSwid: options.espnSwid }
    ),
  };
}

// The stub answers reads from the committed recordings of the real league (`pnpm capture:espn`).
export function createStubEspnClient(options: CreateStubEspnClientOptions = {}): EspnClient {
  const reads = createEspnReadClient({ mode: "stub", ...options });
  const scoreAdjustments = new Map<string, number>();

  return {
    ...reads,
    async applyRosterStep(step: RosterExecutionStep) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: "espn",
          mode: "stub",
          event: "applyRosterStep",
          step,
        })
      );
    },
    async applyScoreAdjustment(teamId: number, matchupId: number, adjustment: number) {
      const key = `${teamId}:${matchupId}`;
      scoreAdjustments.set(key, adjustment);

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: "espn",
          mode: "stub",
          event: "applyScoreAdjustment",
          teamId,
          matchupId,
          adjustment,
        })
      );
    },
  };
}

export function createLiveEspnClient(options: CreateLiveEspnClientOptions): EspnClient {
  const reads = createEspnReadClient({ mode: "live", ...options });

  function notImplemented(method: string): never {
    throw new Error(`Live ESPN client method "${method}" is not implemented yet.`);
  }

  return {
    ...reads,
    async applyRosterStep() {
      return notImplemented("applyRosterStep");
    },
    async applyScoreAdjustment() {
      return notImplemented("applyScoreAdjustment");
    },
  };
}

export function createEspnClient(options: CreateEspnClientOptions): EspnClient {
  if (options.mode === "stub") {
    return createStubEspnClient(options);
  }

  return createLiveEspnClient(options);
}
