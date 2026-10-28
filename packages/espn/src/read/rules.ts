import { calculateFantasyPoints, scoringWeights } from "@injurysub/domain";
import { z } from "zod";
import { lineupSlotNames, type RuleMismatch, type TeamDay } from "./contracts";
import { leagueBaseShape } from "./league";

// The league settings alone, a request no other read makes, since a recording keeps one schema per
// request.
export const RULES_VIEWS = ["mSettings"] as const;

// The settings InjurySub computes with. The roster lock (rosterLocktimeType) is a different rule
// from the lineup lock InjurySub expects, so it isn't read, and neither is the league's name.
export const rulesResponseSchema = z.object({
  ...leagueBaseShape,
  settings: z.object({
    rosterSettings: z.object({
      lineupSlotCounts: z.record(z.string(), z.number().int()),
      lineupLocktimeType: z.string(),
    }),
    scoringSettings: z.object({
      scoringItems: z.array(
        z.object({
          statId: z.number().int(),
          points: z.number(),
          pointsOverrides: z.record(z.string(), z.number()).optional(),
        })
      ),
    }),
  }),
});

type RulesResponse = z.infer<typeof rulesResponseSchema>;
type ScoringItem = RulesResponse["settings"]["scoringSettings"]["scoringItems"][number];

// The league InjurySub expects, by ESPN slot id: C 1, G 3, F 3, F/C 1, UTIL 2, bench 4 and IR 3,
// and no other slot. Each player's lineup slot locks at his first game of the week.
const EXPECTED_SLOT_COUNTS: Readonly<Record<string, number>> = {
  "4": 1,
  "5": 3,
  "6": 3,
  "10": 1,
  "11": 2,
  "12": 4,
  "13": 3,
};
const EXPECTED_LINEUP_LOCK = "INDIVIDUAL_FIRSTGAME_WEEKLY";

// ESPN's stat id for each stat the league formula scores (the ids the day read reads), with the
// domain's weight for it.
const SCORED_STATS = [
  { statId: 0, label: "PTS", weight: scoringWeights.pts },
  { statId: 6, label: "REB", weight: scoringWeights.reb },
  { statId: 3, label: "AST", weight: scoringWeights.ast },
  { statId: 2, label: "STL", weight: scoringWeights.stl },
  { statId: 1, label: "BLK", weight: scoringWeights.blk },
  { statId: 11, label: "TO", weight: scoringWeights.tov },
] as const;

// Fantasy points come in tenths; comparing whole tenths keeps float noise out.
const tenths = (points: number) => Math.round(points * 10);

function settingMismatch(
  name: string,
  expected: string | number,
  espn: string | number
): RuleMismatch {
  return { kind: "setting", setting: name, expected: String(expected), espn: String(espn) };
}

function slotMismatchesOf(counts: Readonly<Record<string, number>>): RuleMismatch[] {
  const slotIds = new Set([...Object.keys(EXPECTED_SLOT_COUNTS), ...Object.keys(counts)]);
  return [...slotIds].flatMap((slotId) => {
    const expected = EXPECTED_SLOT_COUNTS[slotId] ?? 0;
    const espn = counts[slotId] ?? 0;
    const label = lineupSlotNames[Number(slotId)] ?? `slot ${slotId}`;
    return espn === expected ? [] : [settingMismatch(`${label} slots`, expected, espn)];
  });
}

function scoringMismatchesOf(items: readonly ScoringItem[]): RuleMismatch[] {
  const scored = SCORED_STATS.flatMap(({ statId, label, weight }) => {
    const item = items.find((candidate) => candidate.statId === statId);
    if (!item) return [settingMismatch(`${label} points`, weight, "not scored")];
    const overrides = item.pointsOverrides ?? {};
    return [
      ...(item.points === weight ? [] : [settingMismatch(`${label} points`, weight, item.points)]),
      ...(Object.keys(overrides).length === 0
        ? []
        : [settingMismatch(`${label} points overrides`, "none", JSON.stringify(overrides))]),
    ];
  });
  const unscored = items
    .filter((item) => !SCORED_STATS.some((stat) => stat.statId === item.statId))
    .map((item) => settingMismatch(`stat ${item.statId} points`, "not scored", item.points));
  return [...scored, ...unscored];
}

// Each setting that differs from the league InjurySub expects, named.
export function settingMismatchesOf(league: RulesResponse): RuleMismatch[] {
  const { rosterSettings, scoringSettings } = league.settings;
  const lock =
    rosterSettings.lineupLocktimeType === EXPECTED_LINEUP_LOCK
      ? []
      : [settingMismatch("lineup lock", EXPECTED_LINEUP_LOCK, rosterSettings.lineupLocktimeType)];
  return [
    ...slotMismatchesOf(rosterSettings.lineupSlotCounts),
    ...lock,
    ...scoringMismatchesOf(scoringSettings.scoringItems),
  ];
}

// Each played line whose ESPN points the league formula doesn't reproduce from its stats.
export function dayPointMismatchesOf(days: readonly TeamDay[]): RuleMismatch[] {
  return days.flatMap((day) =>
    day.players.flatMap((player): RuleMismatch[] => {
      if (!player.line) return [];
      const { fantasyPoints, points, rebounds, assists, steals, blocks, turnovers } = player.line;
      const formulaPoints = calculateFantasyPoints({
        pts: points,
        reb: rebounds,
        ast: assists,
        stl: steals,
        blk: blocks,
        tov: turnovers,
      });
      if (tenths(formulaPoints) === tenths(fantasyPoints)) return [];
      return [
        {
          kind: "day-points",
          teamId: day.teamId,
          playerId: player.playerId,
          name: player.name,
          scoringPeriodId: day.scoringPeriodId,
          formulaPoints: tenths(formulaPoints) / 10,
          espnPoints: fantasyPoints,
        },
      ];
    })
  );
}
