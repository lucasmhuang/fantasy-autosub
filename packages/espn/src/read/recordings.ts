import { z } from "zod";
import { EspnError } from "./errors";
import type { Recordings } from "./source";

const manifestSchema = z.object({ capturedAt: z.string(), season: z.number().int() });
const recordingFileSchema = z.record(z.string(), z.unknown());

// The committed recordings, imported only when a recorded read first needs them, so live mode
// never loads them. The table is fixed: every capture writes all six files.
const recordingLoaders = {
  "league.json": () => import("../../recordings/league.json"),
  "days.json": () => import("../../recordings/days.json"),
  "matchups.json": () => import("../../recordings/matchups.json"),
  "pro-schedule.json": () => import("../../recordings/pro-schedule.json"),
  "game.json": () => import("../../recordings/game.json"),
  "manifest.json": () => import("../../recordings/manifest.json"),
};

export async function loadCommittedRecordings(): Promise<Recordings> {
  const files = await Promise.all(
    Object.entries(recordingLoaders).map(async ([name, load]) => [name, (await load()).default])
  );
  return recordingsFromFiles(Object.fromEntries(files));
}

// Merges the recording files (each a JSON object of request key → body) into one map, with the
// manifest's capture time and season.
export function recordingsFromFiles(files: Record<string, unknown>): Recordings {
  const manifest = manifestSchema.safeParse(files["manifest.json"]);
  if (!manifest.success) {
    throw new EspnError("unrecognized_response", "the recorded league has no readable manifest", {
      cause: manifest.error,
    });
  }
  const responses = new Map<string, unknown>();
  for (const [name, content] of Object.entries(files)) {
    if (name === "manifest.json") continue;
    const parsed = recordingFileSchema.safeParse(content);
    if (!parsed.success) {
      throw new EspnError(
        "unrecognized_response",
        `the recording ${name} isn't a map of requests`,
        {
          cause: parsed.error,
        }
      );
    }
    for (const [key, body] of Object.entries(parsed.data)) responses.set(key, body);
  }
  return { capturedAt: manifest.data.capturedAt, season: manifest.data.season, responses };
}
