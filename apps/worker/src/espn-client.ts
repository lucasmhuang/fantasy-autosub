import type { ServerEnv } from "@injurysub/config";
import {
  createEspnClient,
  createEspnWriteClient,
  type EspnClient,
  type EspnSendMode,
  type EspnWriteClient,
  SCENARIO_NAMES,
  type ScenarioName,
} from "@injurysub/espn";
import { WorkerStartupError } from "./startup-error";

// The worker's ESPN client for its ESPN_MODE. The settings check has already refused live mode
// without credentials and scripted mode without a scenario.
export function createWorkerEspnClient(env: ServerEnv): EspnClient {
  switch (env.ESPN_MODE) {
    case "stub":
      return createEspnClient({ mode: "stub" });
    case "none":
      return createEspnClient({ mode: "none" });
    case "scripted":
      return createEspnClient({ mode: "scripted", scenario: scenarioOf(env.ESPN_SCENARIO) });
    case "live":
      return createEspnClient({
        mode: "live",
        espnS2: env.ESPN_S2!,
        espnSwid: env.ESPN_SWID!,
        leagueId: env.LEAGUE_ID!,
        seasonYear: env.SEASON_YEAR,
      });
  }
}

// A worker on the recordings or a scenario never sends, so its write client needs no cookie and
// no league: these fill the recorded bodies (the SWID is a lineup body's member id, which must
// have a member id's shape).
const REHEARSAL_CREDENTIALS = {
  espnS2: "rehearsal-only",
  swid: "{00000000-0000-4000-8000-000000000000}",
};
const REHEARSAL_LEAGUE_ID = 0;

// The worker's ESPN write client: none without the cookie (the executor isn't scheduled then); on
// recorded or scripted ESPN one that records every body and sends nothing, whatever the send mode
// says; on live ESPN one that sends only once ESPN_SEND_MODE is live.
export function createWorkerWriteClient(env: ServerEnv): EspnWriteClient | null {
  switch (env.ESPN_MODE) {
    case "none":
      return null;
    case "stub":
    case "scripted":
      return createEspnWriteClient({
        sendMode: "never",
        credentials: REHEARSAL_CREDENTIALS,
        leagueId: REHEARSAL_LEAGUE_ID,
        season: env.SEASON_YEAR,
      });
    case "live":
      return createEspnWriteClient({
        sendMode: env.ESPN_SEND_MODE,
        credentials: { espnS2: env.ESPN_S2!, swid: env.ESPN_SWID! },
        leagueId: env.LEAGUE_ID!,
        season: env.SEASON_YEAR,
      });
  }
}

// What this worker does with an ESPN write, as its own status reports it: sent only on live ESPN
// with ESPN_SEND_MODE live; recorded, or not made at all, otherwise.
export function workerSendMode(env: ServerEnv): EspnSendMode {
  return env.ESPN_MODE === "live" ? env.ESPN_SEND_MODE : "never";
}

function scenarioOf(name: string | undefined): ScenarioName {
  const known = SCENARIO_NAMES.find((scenario) => scenario === name);
  if (known === undefined) {
    throw new WorkerStartupError(
      `ESPN_SCENARIO names no scenario; it must be one of: ${SCENARIO_NAMES.join(", ")}.`
    );
  }
  return known;
}
