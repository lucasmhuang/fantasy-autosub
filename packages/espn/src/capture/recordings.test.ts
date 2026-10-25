import { readdirSync, readFileSync, statSync } from "node:fs";
import { loadServerEnv } from "@injurysub/config";
import { describe, expect, it } from "vitest";
import { RECORDING_FILES } from "./capture";
import { checkRecordingShape } from "./scrub";

// The committed recordings live in a public repo. These checks need no secrets, so they run in CI,
// in the git hooks, and after every capture (FM5).
const recordingsDir = new URL("../../recordings/", import.meta.url);
// Biome skips a file over 1 MiB without checking its format, so every recording stays under it.
const BIOME_MAX_BYTES = 1024 * 1024;

function readRecordings(): Record<string, unknown> {
  return Object.fromEntries(
    RECORDING_FILES.map((name) => [
      name,
      JSON.parse(readFileSync(new URL(name, recordingsDir), "utf8")),
    ])
  );
}

describe("the committed ESPN recordings", () => {
  it("are exactly the six role-named files", () => {
    expect(readdirSync(recordingsDir).sort()).toEqual([...RECORDING_FILES].sort());
  });

  it("hold no member id, cookie or private field, and only placeholder names and ids", () => {
    expect(checkRecordingShape(readRecordings())).toEqual([]);
  });

  it("each stay under Biome's size limit, so the format check covers them", () => {
    for (const name of RECORDING_FILES) {
      expect(statSync(new URL(name, recordingsDir)).size).toBeLessThan(BIOME_MAX_BYTES);
    }
  });

  it("record the season the code is set to read", () => {
    expect(readRecordings()["manifest.json"]).toMatchObject({
      season: loadServerEnv({}).SEASON_YEAR,
    });
  });
});
