import { describe, expect, it } from "vitest";
import { createEspnClient } from "../client";
import { createReadClient } from "./client";
import type { TeamDay } from "./contracts";
import { DAY_VIEWS } from "./day";
import { loadCommittedRecordings } from "./recordings";
import { dayPointMismatchesOf, rulesResponseSchema, settingMismatchesOf } from "./rules";
import { createRecordedSource, requestKey } from "./source";

// ESPN's answer to the settings request for the PRD's league, with the fields InjurySub doesn't
// compare (the roster lock, the scoring type) as ESPN sends them.
function prdSettings() {
  return {
    seasonId: 2027,
    scoringPeriodId: 8,
    status: { currentMatchupPeriod: 2, firstScoringPeriod: 1, finalScoringPeriod: 153 },
    settings: {
      rosterSettings: {
        lineupSlotCounts: { "0": 0, "4": 1, "5": 3, "6": 3, "10": 1, "11": 2, "12": 4, "13": 3 },
        lineupLocktimeType: "INDIVIDUAL_FIRSTGAME_WEEKLY",
        rosterLocktimeType: "FIRSTGAME_WEEKLY",
      },
      scoringSettings: {
        scoringType: "H2H_POINTS",
        scoringItems: [
          { statId: 0, points: 1, pointsOverrides: {} },
          { statId: 6, points: 1.2 },
          { statId: 3, points: 1.5 },
          { statId: 2, points: 3 },
          { statId: 1, points: 3 },
          { statId: 11, points: -1 },
        ],
      },
    },
  };
}

type Settings = ReturnType<typeof prdSettings>;

function mismatchesOf(change: (settings: Settings) => void) {
  const settings = prdSettings();
  change(settings);
  return settingMismatchesOf(rulesResponseSchema.parse(settings));
}

function scoringItem(settings: Settings, statId: number) {
  const item = settings.settings.scoringSettings.scoringItems.find(
    (each) => each.statId === statId
  );
  if (!item) throw new Error(`no scoring item for stat ${statId}`);
  return item;
}

describe("the league settings check", () => {
  it("finds nothing to report in the PRD's league", () => {
    expect(mismatchesOf(() => {})).toEqual([]);
  });

  it.each([
    [
      "an F/C slot count of 2",
      (settings: Settings) => {
        settings.settings.rosterSettings.lineupSlotCounts["10"] = 2;
      },
      { setting: "F/C slots", expected: "1", espn: "2" },
    ],
    [
      "a slot the PRD doesn't have",
      (settings: Settings) => {
        settings.settings.rosterSettings.lineupSlotCounts["0"] = 1;
      },
      { setting: "PG slots", expected: "0", espn: "1" },
    ],
    [
      "a daily lineup lock",
      (settings: Settings) => {
        settings.settings.rosterSettings.lineupLocktimeType = "INDIVIDUAL_GAME";
      },
      { setting: "lineup lock", expected: "INDIVIDUAL_FIRSTGAME_WEEKLY", espn: "INDIVIDUAL_GAME" },
    ],
    [
      "a changed REB weight",
      (settings: Settings) => {
        scoringItem(settings, 6).points = 1.5;
      },
      { setting: "REB points", expected: "1.2", espn: "1.5" },
    ],
    [
      "turnovers no longer scored",
      (settings: Settings) => {
        settings.settings.scoringSettings.scoringItems =
          settings.settings.scoringSettings.scoringItems.filter((item) => item.statId !== 11);
      },
      { setting: "TO points", expected: "-1", espn: "not scored" },
    ],
    [
      "a stat the formula doesn't score",
      (settings: Settings) => {
        settings.settings.scoringSettings.scoringItems.push({ statId: 17, points: 0.5 });
      },
      { setting: "stat 17 points", expected: "not scored", espn: "0.5" },
    ],
    [
      "points overrides on PTS",
      (settings: Settings) => {
        scoringItem(settings, 0).pointsOverrides = { "11": 2 };
      },
      { setting: "PTS points overrides", expected: "none", espn: '{"11":2}' },
    ],
  ])("reports %s, naming the setting", (_, change, mismatch) => {
    expect(mismatchesOf(change)).toEqual([{ kind: "setting", ...mismatch }]);
  });

  it("never compares the roster lock, which isn't the PRD's lineup lock", () => {
    expect(
      mismatchesOf((settings) => {
        settings.settings.rosterSettings.rosterLocktimeType = "DAILY";
      })
    ).toEqual([]);
  });
});

function teamDay(fantasyPoints: number): TeamDay {
  return {
    teamId: 3,
    scoringPeriodId: 7,
    players: [
      {
        playerId: 3001,
        name: "Avery Example",
        slot: "C",
        active: true,
        lineupLocked: true,
        line: {
          fantasyPoints,
          points: 24,
          rebounds: 11,
          assists: 2,
          steals: 1,
          blocks: 2,
          turnovers: 3,
        },
      },
      {
        playerId: 3002,
        name: "Blake Example",
        slot: "BE",
        active: false,
        lineupLocked: true,
        line: null,
      },
    ],
  };
}

describe("the played-day points check", () => {
  it("accepts a line whose ESPN points the league formula reproduces", () => {
    expect(dayPointMismatchesOf([teamDay(46.2)])).toEqual([]);
  });

  it("reports a line whose ESPN points the formula doesn't reproduce, naming the player and day", () => {
    expect(dayPointMismatchesOf([teamDay(47.2)])).toEqual([
      {
        kind: "day-points",
        teamId: 3,
        playerId: 3001,
        name: "Avery Example",
        scoringPeriodId: 7,
        formulaPoints: 46.2,
        espnPoints: 47.2,
      },
    ]);
  });
});

// The committed recording of the real league.
describe("the recorded league's rules", () => {
  it("match the PRD's, with every complete day's points reproduced by the formula", async () => {
    const rules = await createEspnClient({ mode: "stub" }).checkLeagueRules();

    expect(rules.meta.source).toBe("recorded");
    expect(rules.mismatches).toEqual([]);
  });

  it("report a recorded day line whose points are changed, naming its player and day", async () => {
    const recordings = await loadCommittedRecordings();
    const { week } = await createReadClient(
      createRecordedSource(async () => recordings)
    ).getCurrentWeek();
    const [day] = week.completeScoringPeriodIds;
    if (day === undefined) throw new Error("the recording has no complete day");
    const key = requestKey({ kind: "league", views: DAY_VIEWS, scoringPeriodId: day });
    const body = structuredClone(recordings.responses.get(key));
    const changed = firstDayLineOf(body, day);
    if (!changed) throw new Error(`the recording has no day line on scoring period ${day}`);
    changed.line.appliedTotal += 1;
    const responses = new Map(recordings.responses).set(key, body);

    const rules = await createReadClient(
      createRecordedSource(async () => ({ ...recordings, responses }))
    ).checkLeagueRules();

    expect(rules.mismatches).toEqual([
      expect.objectContaining({
        kind: "day-points",
        playerId: changed.playerId,
        scoringPeriodId: day,
      }),
    ]);
  });
});

type RecordedEntry = {
  playerId: number;
  playerPoolEntry: {
    player: { stats?: { scoringPeriodId: number; appliedTotal: number; stats: object }[] };
  };
};

type RecordedDay = { teams: { roster?: { entries: RecordedEntry[] } }[] };

// A recorded day body, trimmed by the day read's schema, which keeps these fields.
function isRecordedDay(body: unknown): body is RecordedDay {
  return typeof body === "object" && body !== null && Array.isArray(Reflect.get(body, "teams"));
}

// The first entry, on any team, with an actual line for the day that holds stats.
function firstDayLineOf(body: unknown, day: number) {
  if (!isRecordedDay(body)) throw new Error("the recorded day has no teams");
  for (const entry of body.teams.flatMap((team) => team.roster?.entries ?? [])) {
    const line = (entry.playerPoolEntry.player.stats ?? []).find(
      (stat) => stat.scoringPeriodId === day && Object.keys(stat.stats).length > 0
    );
    if (line) return { playerId: entry.playerId, line };
  }
  return undefined;
}
