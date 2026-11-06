import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRecordingShape, findDuplicateKeys } from "../capture/scrub";
import { createEspnReadClient } from "../client";
import type { TeamLineup } from "../read/contracts";
import { EspnError } from "../read/errors";
import { buildScenarioFiles, SCENARIO_NAMES, type ScenarioName } from "./build";

// Like the recordings, scenarios are public and never hand-edited: `pnpm scenarios:build`
// regenerates them from the recordings by the named transforms, and formats them.
const scenariosDir = new URL("../../scenarios/", import.meta.url);
const BIOME_MAX_BYTES = 1024 * 1024;

function committedText(name: string): string {
  return readFileSync(new URL(name, scenariosDir), "utf8");
}

async function rejectionOf(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

function scripted(scenario: ScenarioName) {
  return createEspnReadClient({ mode: "scripted", scenario });
}

function designationsOf(lineup: TeamLineup): Record<number, string> {
  return Object.fromEntries(
    lineup.starters.flatMap(({ player }) =>
      player && player.designation.status !== "ACTIVE"
        ? [[player.playerId, player.designation.status]]
        : []
    )
  );
}

describe("the committed ESPN scenarios", () => {
  it("are exactly one file per named scenario", () => {
    expect(readdirSync(scenariosDir).sort()).toEqual(
      SCENARIO_NAMES.map((name) => `${name}.json`).sort()
    );
  });

  it("are what the builder makes from the recordings, unedited", async () => {
    const built = await buildScenarioFiles();

    expect(Object.keys(built).sort()).toEqual(SCENARIO_NAMES.map((name) => `${name}.json`).sort());

    for (const [name, text] of Object.entries(built)) {
      expect({ name, scenario: JSON.parse(committedText(name)) }).toEqual({
        name,
        scenario: JSON.parse(text),
      });
    }
  });

  it("hold no member id, cookie or private field, and no duplicate key", () => {
    for (const name of SCENARIO_NAMES) {
      const text = committedText(`${name}.json`);
      expect(checkRecordingShape({ [name]: JSON.parse(text).responses })).toEqual([]);
      expect(findDuplicateKeys(text)).toEqual([]);
    }
  });

  it("each stay under Biome's size limit, so the format check covers them", () => {
    for (const name of SCENARIO_NAMES) {
      expect(statSync(new URL(`${name}.json`, scenariosDir)).size).toBeLessThan(BIOME_MAX_BYTES);
    }
  });
});

describe("the scripted ESPN client", () => {
  it("shows team 1 with one guard starter OUT", async () => {
    const { lineup } = await scripted("one-out-starter").getTeamWeek(1);

    expect(designationsOf(lineup)).toEqual({ 6606: "OUT" });
  });

  it("shows team 1 with two starters OUT", async () => {
    const { lineup } = await scripted("two-out-starters").getTeamWeek(1);

    expect(designationsOf(lineup)).toEqual({ 6606: "OUT", 4065648: "OUT" });
  });

  it("shows team 1 with a suspended starter", async () => {
    const { lineup } = await scripted("suspended-starter").getTeamWeek(1);

    expect(designationsOf(lineup)).toEqual({ 6606: "SUSPENSION" });
  });

  it("finds the league's lineup lock differing from the one InjurySub expects", async () => {
    const { mismatches } = await scripted("rules-mismatch").checkLeagueRules();

    expect(mismatches).toContainEqual(
      expect.objectContaining({ kind: "setting", setting: "lineup lock", espn: "DAILY" })
    );
  });

  it("refuses every read as ESPN refusing the credentials", async () => {
    const client = scripted("credentials-rejected");

    expect((await rejectionOf(client.getTeamWeek(1))).code).toBe("credentials_rejected");
    expect((await rejectionOf(client.checkCredentials())).code).toBe("credentials_rejected");
  });

  it("shows the season's final week concluded, every day complete", async () => {
    const { week, days } = await scripted("week-concluded").getTeamWeek(1);

    expect(week.scoringPeriodIds).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(week.completeScoringPeriodIds).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(week.todayScoringPeriodId).toBe(14);
    expect(days.map((day) => day.scoringPeriodId)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });
});
