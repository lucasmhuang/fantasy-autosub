import type { EspnReadClient, EspnRosterSnapshot } from "./read/contracts";
import type { EspnWriteClient, RosterExecutionStep } from "./write/contracts";

export type EspnMode = "stub" | "live";

export type EspnClient = EspnReadClient &
  EspnWriteClient & {
    mode: EspnMode;
  };

export type CreateStubEspnClientOptions = {
  roster?: EspnRosterSnapshot;
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

export const defaultStubRosterSnapshot: EspnRosterSnapshot = {
  teamId: 1,
  scoringPeriodId: 1,
  starters: [
    {
      playerId: 1001,
      lineupSlotId: 6,
      injuryStatus: "OUT",
    },
  ],
  bench: [
    {
      playerId: 2001,
      lineupSlotId: 12,
    },
  ],
};

function cloneSnapshot(snapshot: EspnRosterSnapshot): EspnRosterSnapshot {
  return {
    ...snapshot,
    starters: snapshot.starters.map((starter) => ({ ...starter })),
    bench: snapshot.bench.map((benchPlayer) => ({ ...benchPlayer })),
  };
}

export function createStubEspnClient(options: CreateStubEspnClientOptions = {}): EspnClient {
  const roster = cloneSnapshot(options.roster ?? defaultStubRosterSnapshot);
  const scoreAdjustments = new Map<string, number>();

  return {
    mode: "stub",
    async getRoster(teamId: number, scoringPeriodId: number) {
      return cloneSnapshot({
        ...roster,
        teamId,
        scoringPeriodId,
      });
    },
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
  function notImplemented(method: string): never {
    throw new Error(
      `Live ESPN client method "${method}" is not implemented yet. Received config for league ${options.leagueId} in season ${options.seasonYear}.`
    );
  }

  return {
    mode: "live",
    async getRoster() {
      return notImplemented("getRoster");
    },
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
