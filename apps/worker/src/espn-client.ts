import type { ServerEnv } from "@injurysub/config";
import {
  createEspnClient,
  type EspnClient,
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

function scenarioOf(name: string | undefined): ScenarioName {
  const known = SCENARIO_NAMES.find((scenario) => scenario === name);
  if (known === undefined) {
    throw new WorkerStartupError(
      `ESPN_SCENARIO names no scenario; it must be one of: ${SCENARIO_NAMES.join(", ")}.`
    );
  }
  return known;
}
