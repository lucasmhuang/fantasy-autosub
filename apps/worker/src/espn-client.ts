import type { ServerEnv } from "@injurysub/config";
import {
  createEspnClient,
  createEspnWriteClient,
  type EspnClient,
  type EspnWriteClient,
  SCENARIO_NAMES,
  type ScenarioName,
  type WorkerSendMode,
} from "@injurysub/espn";
import { createFakeEspn, type FakeEspn } from "./fake-espn";
import { WorkerStartupError } from "./startup-error";

export type WorkerEspn = {
  read: EspnClient;
  // None without the cookie: the executor isn't scheduled then.
  write: EspnWriteClient | null;
  // The fake ESPN a practice worker reads and writes; null in every other mode.
  practice: FakeEspn | null;
};

// A worker on the recordings or a scenario never sends, and a practice worker sends only to its
// fake, so their write clients need no cookie and no league: these fill the bodies (the SWID is a
// lineup body's member id, which must have a member id's shape).
const REHEARSAL_CREDENTIALS = {
  espnS2: "rehearsal-only",
  swid: "{00000000-0000-4000-8000-000000000000}",
};
const REHEARSAL_LEAGUE_ID = 0;

// The worker's ESPN for its ESPN_MODE: what it reads, and the client its writes go through. On
// recorded or scripted ESPN every write is recorded and none sent, whatever the send mode says; on
// live ESPN one is sent only once ESPN_SEND_MODE is live; in practice every write is sent, to the
// fake alone. The settings check has already refused live mode without credentials and scripted
// mode without a scenario.
export async function createWorkerEspn(env: ServerEnv): Promise<WorkerEspn> {
  switch (env.ESPN_MODE) {
    case "none":
      return { read: createEspnClient({ mode: "none" }), write: null, practice: null };
    case "stub":
      return {
        read: createEspnClient({ mode: "stub" }),
        write: createRehearsalWriteClient(env),
        practice: null,
      };
    case "scripted":
      return {
        read: createEspnClient({ mode: "scripted", scenario: scenarioOf(env.ESPN_SCENARIO) }),
        write: createRehearsalWriteClient(env),
        practice: null,
      };
    case "live":
      return createLiveEspn(env);
    case "practice":
      return createPracticeEspn(env);
  }
}

function createRehearsalWriteClient(env: ServerEnv): EspnWriteClient {
  return createEspnWriteClient({
    sendMode: "never",
    credentials: REHEARSAL_CREDENTIALS,
    leagueId: REHEARSAL_LEAGUE_ID,
    season: env.SEASON_YEAR,
    fetch: globalThis.fetch,
  });
}

function createLiveEspn(env: ServerEnv): WorkerEspn {
  const credentials = { espnS2: env.ESPN_S2!, swid: env.ESPN_SWID! };
  const read = createEspnClient({
    mode: "live",
    espnS2: credentials.espnS2,
    espnSwid: credentials.swid,
    leagueId: env.LEAGUE_ID!,
    seasonYear: env.SEASON_YEAR,
  });
  const write = createEspnWriteClient({
    sendMode: env.ESPN_SEND_MODE,
    credentials,
    leagueId: env.LEAGUE_ID!,
    season: env.SEASON_YEAR,
    fetch: globalThis.fetch,
  });
  return { read, write, practice: null };
}

// The fake ESPN, seeded from the recordings or the named scenario. Its write client sends live
// through the fake's own fetch, with the rehearsal cookie and league 0, so no write it makes could
// be one the real league would take.
async function createPracticeEspn(env: ServerEnv): Promise<WorkerEspn> {
  const scenario = env.ESPN_SCENARIO === undefined ? undefined : scenarioOf(env.ESPN_SCENARIO);
  const practice = await createFakeEspn({
    scenario,
    credentials: REHEARSAL_CREDENTIALS,
    leagueId: REHEARSAL_LEAGUE_ID,
  });
  return { read: practice.read, write: practice.write, practice };
}

// What this worker does with an ESPN write, as its own status reports it: sent to the real league
// only on live ESPN with ESPN_SEND_MODE live; sent to the practice copy in practice; recorded, or
// not made at all, otherwise.
export function workerSendMode(env: ServerEnv): WorkerSendMode {
  if (env.ESPN_MODE === "practice") return "practice";
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
