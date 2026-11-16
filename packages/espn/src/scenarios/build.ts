import { createReadClient } from "../read/client";
import { DAY_VIEWS } from "../read/day";
import { EspnError, type EspnErrorCode } from "../read/errors";
import { LINEUP_VIEWS } from "../read/league";
import { PRO_SCHEDULE_VIEWS } from "../read/outlook";
import { loadCommittedRecordings } from "../read/recordings";
import { RULES_VIEWS } from "../read/rules";
import { scoreboardDayOf } from "../read/scoreboard";
import { createRecordedSource, type Recordings, requestKey } from "../read/source";
import { WEEK_VIEWS } from "../read/week";

// Named ESPN states the recordings can't show on demand (an OUT or suspended starter, a rules
// mismatch, rejected credentials, a concluded week), for local runs, staging and the UI pass.
// Each is the committed recordings with some answers replaced, made by a transform here, never
// by hand: `pnpm scenarios:build` writes them to packages/espn/scenarios/.
export const SCENARIO_NAMES = [
  "one-out-starter",
  "two-out-starters",
  "suspended-starter",
  "rules-mismatch",
  "credentials-rejected",
  "week-concluded",
  "live-games",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

// The answers a scenario replaces, by request key; or a code every read is refused with.
export type Scenario = {
  name: ScenarioName;
  description: string;
  refuseWith: EspnErrorCode | null;
  responses: Record<string, unknown>;
};

const LINEUPS_KEY = requestKey({ kind: "league", views: LINEUP_VIEWS });
const WEEK_KEY = requestKey({ kind: "league", views: WEEK_VIEWS });
const RULES_KEY = requestKey({ kind: "league", views: RULES_VIEWS });
const dayKey = (day: number) =>
  requestKey({ kind: "league", views: DAY_VIEWS, scoringPeriodId: day });

// Team 1's starters at the 2026-10-27 capture: a guard (G) and a forward (F). With 6606 out, the
// bench guards fit his slot directly, and the bench centers fit once the UTIL guard moves to G.
const TEAM = 1;
const GUARD = 6606;
const FORWARD = 4065648;

type RosterBody = {
  teams: {
    id: number;
    roster: {
      entries: { playerId: number; playerPoolEntry: { player: { injuryStatus?: string } } }[];
    };
  }[];
};

function answer<T>(recordings: Recordings, key: string): T {
  if (!recordings.responses.has(key)) {
    throw new EspnError(
      "not_recorded",
      `the recordings don't hold ${key}, which a scenario changes`
    );
  }
  return structuredClone(recordings.responses.get(key)) as T;
}

function withDesignations(recordings: Recordings, designations: Record<number, string>) {
  const body = answer<RosterBody>(recordings, LINEUPS_KEY);
  const team = body.teams.find((candidate) => candidate.id === TEAM);
  if (!team) throw new EspnError("team_not_found", `the recordings have no team ${TEAM}`);
  for (const entry of team.roster.entries) {
    const designation = designations[entry.playerId];
    if (designation !== undefined) entry.playerPoolEntry.player.injuryStatus = designation;
  }
  return { [LINEUPS_KEY]: body };
}

function withLineupLock(recordings: Recordings, lockType: string) {
  const body = answer<{ settings: { rosterSettings: { lineupLocktimeType: string } } }>(
    recordings,
    RULES_KEY
  );
  body.settings.rosterSettings.lineupLocktimeType = lockType;
  return { [RULES_KEY]: body };
}

// The season ended with the recorded week: its last day is the final one and ESPN's day is the
// next, so every day is complete. Days the capture didn't reach are the latest recorded day's
// answer with no lines (no games), as a day after the capture would have none recorded.
async function weekConcluded(recordings: Recordings) {
  const { week } = await createReadClient(
    createRecordedSource(async () => recordings)
  ).getCurrentWeek();
  const lastDay = Math.max(...week.scoringPeriodIds);
  const body = answer<{ scoringPeriodId: number; status: { finalScoringPeriod: number } }>(
    recordings,
    WEEK_KEY
  );
  body.scoringPeriodId = lastDay + 1;
  body.status.finalScoringPeriod = lastDay;
  const recordedDays = week.scoringPeriodIds.filter((day) => recordings.responses.has(dayKey(day)));
  const latest = Math.max(...recordedDays);
  const missing = week.scoringPeriodIds.filter((day) => !recordedDays.includes(day));
  return {
    [WEEK_KEY]: body,
    ...Object.fromEntries(missing.map((day) => [dayKey(day), emptyDay(recordings, latest, day)])),
  };
}

function emptyDay(recordings: Recordings, from: number, day: number) {
  const body = answer<{
    scoringPeriodId: number;
    teams: { roster?: { entries: { playerPoolEntry: { player: { stats?: unknown[] } } }[] } }[];
  }>(recordings, dayKey(from));
  body.scoringPeriodId = day;
  for (const team of body.teams) {
    for (const entry of team.roster?.entries ?? []) entry.playerPoolEntry.player.stats = [];
  }
  return body;
}

// The recorded day (8) is 2026-10-27, Pacific: ESPN's day n is 2026-10-19 plus n.
const RECORDED_DATE = "2026-10-27";
const SCOREBOARD_KEY = requestKey({ kind: "scoreboard", views: [scoreboardDayOf(RECORDED_DATE)] });
const PRO_SCHEDULE_KEY = requestKey({ kind: "pro-schedule", views: PRO_SCHEDULE_VIEWS });

type ProScheduleBody = {
  settings: {
    proTeams: {
      id: number;
      abbrev: string;
      proGamesByScoringPeriod?: Record<
        string,
        { date: number; homeProTeamId: number; awayProTeamId: number }[]
      >;
    }[];
  };
};

// Day 8's slate as ESPN's NBA scoreboard would show it early in the evening: every game in its
// first period but the night's last tip, not yet started. Live with no points scored yet, so the
// recorded day lines and scores still agree with it (the capture predates that night's games).
async function liveGames(recordings: Recordings) {
  const { proTeams } = answer<ProScheduleBody>(recordings, PRO_SCHEDULE_KEY).settings;
  const abbreviations = new Map(proTeams.map((team) => [team.id, team.abbrev]));
  const games = new Map<string, { date: number; homeProTeamId: number; awayProTeamId: number }>();
  for (const team of proTeams) {
    for (const game of team.proGamesByScoringPeriod?.["8"] ?? []) {
      games.set(`${game.date}:${game.homeProTeamId}:${game.awayProTeamId}`, game);
    }
  }
  const lastTip = Math.max(...[...games.values()].map((game) => game.date));
  const events = [...games.values()]
    .sort((a, b) => a.date - b.date)
    .map((game) => {
      const live = game.date < lastTip;
      const side = (homeAway: string, id: number) => ({
        homeAway,
        team: { id: String(id), abbreviation: abbreviations.get(id) ?? "" },
      });
      return {
        date: `${new Date(game.date).toISOString().slice(0, 16)}Z`,
        status: live
          ? {
              period: 1,
              displayClock: "8:42",
              type: {
                state: "in",
                name: "STATUS_IN_PROGRESS",
                completed: false,
                shortDetail: "8:42 - 1st",
              },
            }
          : {
              period: 0,
              displayClock: "0.0",
              type: {
                state: "pre",
                name: "STATUS_SCHEDULED",
                completed: false,
                shortDetail: "Scheduled",
              },
            },
        competitions: [
          {
            competitors: [side("home", game.homeProTeamId), side("away", game.awayProTeamId)],
          },
        ],
      };
    });
  return {
    ...withDesignations(recordings, { [GUARD]: "OUT" }),
    [SCOREBOARD_KEY]: { events },
  };
}

const DESCRIPTIONS: Record<ScenarioName, string> = {
  "one-out-starter":
    "Team 1's G starter is OUT; bench guards fit directly, bench centers by a rearrangement.",
  "two-out-starters": "Team 1 has a G and an F starter OUT.",
  "suspended-starter": "Team 1's G starter is suspended.",
  "rules-mismatch": "The league's lineup lock is daily, not the weekly lock InjurySub expects.",
  "credentials-rejected": "ESPN refuses the cookie on every read.",
  "week-concluded": "The season ended with the recorded week; ESPN's day is past its last day.",
  "live-games":
    "Team 1's G starter is OUT, and day 8's games are in their first period, but the last tip; no points yet.",
};

async function scenarioFor(name: ScenarioName, recordings: Recordings): Promise<Scenario> {
  return {
    name,
    refuseWith: name === "credentials-rejected" ? "credentials_rejected" : null,
    description: DESCRIPTIONS[name],
    responses: await responsesFor(name, recordings),
  };
}

async function responsesFor(
  name: ScenarioName,
  recordings: Recordings
): Promise<Scenario["responses"]> {
  switch (name) {
    case "one-out-starter":
      return withDesignations(recordings, { [GUARD]: "OUT" });
    case "two-out-starters":
      return withDesignations(recordings, { [GUARD]: "OUT", [FORWARD]: "OUT" });
    case "suspended-starter":
      return withDesignations(recordings, { [GUARD]: "SUSPENSION" });
    case "rules-mismatch":
      return withLineupLock(recordings, "DAILY");
    case "credentials-rejected":
      return {};
    case "week-concluded":
      return weekConcluded(recordings);
    case "live-games":
      return liveGames(recordings);
  }
}

// Every scenario's file, by file name, as `pnpm scenarios:build` writes it before formatting.
export async function buildScenarioFiles(): Promise<Record<string, string>> {
  const recordings = await loadCommittedRecordings();
  const scenarios = await Promise.all(SCENARIO_NAMES.map((name) => scenarioFor(name, recordings)));
  return Object.fromEntries(
    scenarios.map((scenario) => [`${scenario.name}.json`, `${JSON.stringify(scenario, null, 2)}\n`])
  );
}
