import { z } from "zod";
import { EspnError, type EspnErrorCode, espnErrorCodes } from "../read/errors";
import { loadCommittedRecordings } from "../read/recordings";
import { createRecordedSource, type EspnSource, type Recordings } from "../read/source";
import type { ScenarioName } from "./build";

// Imported only when a scripted read first needs one, as the recordings are.
const scenarioLoaders: Record<ScenarioName, () => Promise<{ default: unknown }>> = {
  "one-out-starter": () => import("../../scenarios/one-out-starter.json"),
  "two-out-starters": () => import("../../scenarios/two-out-starters.json"),
  "suspended-starter": () => import("../../scenarios/suspended-starter.json"),
  "rules-mismatch": () => import("../../scenarios/rules-mismatch.json"),
  "credentials-rejected": () => import("../../scenarios/credentials-rejected.json"),
  "week-concluded": () => import("../../scenarios/week-concluded.json"),
};

const scenarioFileSchema = z.object({
  refuseWith: z.enum(espnErrorCodes).nullable(),
  responses: z.record(z.string(), z.unknown()),
});

type LoadedScenario = { recordings: Recordings; refuseWith: EspnErrorCode | null };

async function loadScenario(name: ScenarioName): Promise<LoadedScenario> {
  const parsed = scenarioFileSchema.safeParse((await scenarioLoaders[name]()).default);
  if (!parsed.success) {
    throw new EspnError("unrecognized_response", `the scenario ${name} isn't readable`, {
      cause: parsed.error,
    });
  }
  const recordings = await loadCommittedRecordings();
  const responses = new Map(recordings.responses);
  for (const [key, body] of Object.entries(parsed.data.responses)) responses.set(key, body);
  return { recordings: { ...recordings, responses }, refuseWith: parsed.data.refuseWith };
}

// A scenario's answers over the recordings, read through the recorded source; a scenario that
// refuses fails every request with its code instead.
export function createScriptedSource(name: ScenarioName): EspnSource {
  let loading: Promise<LoadedScenario> | undefined;
  const scenario = () => (loading ??= loadScenario(name));
  const recorded = createRecordedSource(async () => (await scenario()).recordings);
  return async (request) => {
    const { refuseWith } = await scenario();
    if (refuseWith !== null) {
      throw new EspnError(refuseWith, `the scenario ${name} refuses ${request.readName}`);
    }
    return recorded(request);
  };
}

// The scenario's credential check: it passes unless the scenario refuses.
export async function checkScenarioCredentials(name: ScenarioName) {
  const { refuseWith } = await loadScenario(name);
  if (refuseWith !== null) {
    throw new EspnError(refuseWith, `the scenario ${name} refuses the ESPN credential check`);
  }
  return { ok: true as const, source: "recorded" as const };
}
