import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEspnClient } from "../client";
import { createReadClient } from "./client";
import type { LineupSlot, LineupSlotName } from "./contracts";
import { EspnError } from "./errors";
import { LINEUP_VIEWS, lineupResponseSchema } from "./league";
import { loadCommittedRecordings } from "./recordings";
import { createRecordedSource, type Recordings, requestKey } from "./source";

// Made-up teams and players, shaped like ESPN's answer to one request for mRoster, mSettings,
// mStatus and mTeam. The slot counts are this league's: C 1, G 3, F 3, F/C 1, UTIL 2, 4 bench, 3 IR.
const lineupSlotCounts = { "0": 0, "4": 1, "5": 3, "6": 3, "10": 1, "11": 2, "12": 4, "13": 3 };

function entry(
  playerId: number,
  lineupSlotId: number,
  player: { injuryStatus?: string; eligibleSlots?: number[] } = { injuryStatus: "ACTIVE" },
  lineupLocked = false
) {
  return {
    playerId,
    lineupSlotId,
    playerPoolEntry: {
      lineupLocked,
      player: {
        fullName: `Player ${playerId}`,
        proTeamId: 9,
        eligibleSlots: player.eligibleSlots ?? [4, 11, 12, 13],
        ...("injuryStatus" in player ? { injuryStatus: player.injuryStatus } : {}),
      },
    },
  };
}

function leagueBody(teams: unknown[]) {
  return {
    seasonId: 2027,
    scoringPeriodId: 5,
    status: { currentMatchupPeriod: 1 },
    settings: { rosterSettings: { lineupSlotCounts } },
    teams,
  };
}

function readClientFor(body: unknown) {
  const recordings: Recordings = {
    capturedAt: "2026-10-25T01:00:00.000Z",
    season: 2027,
    responses: new Map([[requestKey({ kind: "league", views: LINEUP_VIEWS }), body]]),
  };
  return createReadClient(
    createRecordedSource(async () => recordings),
    { now: () => new Date("2026-10-25T02:00:00.000Z") }
  );
}

async function readFailure(read: Promise<unknown>): Promise<EspnError> {
  try {
    await read;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

const empty = (slot: LineupSlotName): LineupSlot => ({ slot, player: null });

// Team 1 has a player at C, G and F, one on the bench and one on IR, with designations ESPN knows,
// one it doesn't (QUESTIONABLE) and none at all. Team 2 has no players.
const twoTeams = leagueBody([
  {
    id: 1,
    name: "Team 1",
    roster: {
      entries: [
        entry(101, 4, { injuryStatus: "OUT" }, true),
        entry(102, 5, { injuryStatus: "SUSPENSION", eligibleSlots: [0, 5, 8, 11, 12, 13] }),
        entry(103, 6, { injuryStatus: "QUESTIONABLE" }),
        entry(104, 12, {}),
        entry(105, 13, { injuryStatus: "OUT" }),
      ],
    },
  },
  { id: 2, name: "Team 2", roster: { entries: [] } },
]);

// A player as the read gives back one made by `entry`, with what differs from its defaults.
function readPlayer(playerId: number, designation: object, extra: object = {}) {
  return {
    playerId,
    name: `Player ${playerId}`,
    proTeamId: 9,
    eligibleSlots: ["C", "UTIL", "BE", "IR"],
    designation,
    lineupLocked: false,
    ...extra,
  };
}

async function teamsOfTwoTeams() {
  const { teams } = await readClientFor(twoTeams).getLineups();
  expect(teams.map((team) => team.teamId)).toEqual([1, 2]);
  return teams;
}

describe("lineup reads", () => {
  it("labels every team's lineup as recorded, with its season, week and day, and its read time", async () => {
    const read = await readClientFor(twoTeams).getLineups();

    expect(read.meta).toEqual({
      source: "recorded",
      capturedAt: "2026-10-25T01:00:00.000Z",
      season: 2027,
      matchupPeriodId: 1,
      scoringPeriodId: 5,
      readAt: "2026-10-25T02:00:00.000Z",
    });
  });

  it("reads each starting slot by type, empty ones included", async () => {
    const [team] = await teamsOfTwoTeams();

    expect(team).toMatchObject({ teamId: 1, teamName: "Team 1" });
    expect(team?.starters).toEqual([
      { slot: "C", player: readPlayer(101, { status: "OUT" }, { lineupLocked: true }) },
      {
        slot: "G",
        player: readPlayer(
          102,
          { status: "SUSPENSION" },
          { eligibleSlots: ["PG", "G", "G/F", "UTIL", "BE", "IR"] }
        ),
      },
      empty("G"),
      empty("G"),
      { slot: "F", player: readPlayer(103, { status: "unrecognized", raw: "QUESTIONABLE" }) },
      empty("F"),
      empty("F"),
      empty("F/C"),
      empty("UTIL"),
      empty("UTIL"),
    ]);
  });

  it("reads the bench and IR after the starters, empty slots included", async () => {
    const [team] = await teamsOfTwoTeams();

    expect(team).toEqual({
      teamId: 1,
      teamName: "Team 1",
      starters: expect.any(Array),
      bench: [
        { slot: "BE", player: readPlayer(104, { status: "unrecognized", raw: null }) },
        empty("BE"),
        empty("BE"),
        empty("BE"),
      ],
      injuredReserve: [
        { slot: "IR", player: readPlayer(105, { status: "OUT" }) },
        empty("IR"),
        empty("IR"),
      ],
    });
  });

  it("reads a team with no players as every slot empty", async () => {
    const [, team] = await teamsOfTwoTeams();

    expect(team).toEqual({
      teamId: 2,
      teamName: "Team 2",
      starters: ["C", "G", "G", "G", "F", "F", "F", "F/C", "UTIL", "UTIL"].map((slot) =>
        empty(slot as LineupSlotName)
      ),
      bench: [empty("BE"), empty("BE"), empty("BE"), empty("BE")],
      injuredReserve: [empty("IR"), empty("IR"), empty("IR")],
    });
  });

  // ESPN's four known designations, as it sends them. The substitution rule decides on them, so
  // each must read as itself, never as unrecognized.
  it("reads a starter with each known designation as that designation", async () => {
    const designations = ["ACTIVE", "DAY_TO_DAY", "OUT", "SUSPENSION"];
    const client = readClientFor(
      leagueBody([
        {
          id: 4,
          name: "Team 4",
          roster: {
            entries: designations.map((injuryStatus, index) =>
              entry(401 + index, index === 0 ? 4 : 5, { injuryStatus })
            ),
          },
        },
      ])
    );

    const { team } = await client.getLineup(4);

    const designationsById = Object.fromEntries(
      team.starters.flatMap((slot) =>
        slot.player ? [[slot.player.playerId, slot.player.designation]] : []
      )
    );
    expect(designationsById).toEqual({
      401: { status: "ACTIVE" },
      402: { status: "DAY_TO_DAY" },
      403: { status: "OUT" },
      404: { status: "SUSPENSION" },
    });
  });

  it("reads one team's lineup, and says when a team isn't in the league", async () => {
    const client = readClientFor(
      leagueBody([{ id: 7, name: "Team 7", roster: { entries: [entry(701, 4)] } }])
    );

    const read = await client.getLineup(7);
    const missing = await readFailure(client.getLineup(999));

    expect(read.team.teamId).toBe(7);
    expect(read.team.starters[0]?.player?.playerId).toBe(701);
    expect(missing.code).toBe("team_not_found");
    expect(missing.message).toMatch(/team 999/);
  });

  it.each([
    ["a slot id ESPN's slot map doesn't have", 14],
    ["a slot this league doesn't use", 0],
  ])("refuses a lineup with a player in %s, naming the team, player and slot", async (_, slotId) => {
    const client = readClientFor(
      leagueBody([
        { id: 3, name: "Team 3", roster: { entries: [entry(301, 4), entry(302, slotId)] } },
      ])
    );

    const error = await readFailure(client.getLineups());

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/team 3/);
    expect(error.message).toMatch(/Player 302 \(302\)/);
    expect(error.message).toMatch(new RegExp(`slot ${slotId}\\b`));
  });

  it("refuses a lineup with more players in a slot than the league allows", async () => {
    const client = readClientFor(
      leagueBody([{ id: 3, name: "Team 3", roster: { entries: [entry(301, 4), entry(302, 4)] } }])
    );

    const error = await readFailure(client.getLineups());

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/team 3/);
    expect(error.message).toMatch(/2 players in C/);
  });

  it("refuses an eligible slot ESPN's slot map doesn't have, naming the player", async () => {
    const client = readClientFor(
      leagueBody([
        {
          id: 3,
          name: "Team 3",
          roster: { entries: [entry(301, 4, { injuryStatus: "ACTIVE", eligibleSlots: [4, 15] })] },
        },
      ])
    );

    const error = await readFailure(client.getLineups());

    expect(error.code).toBe("unrecognized_response");
    expect(error.message).toMatch(/Player 301 \(301\)/);
    expect(error.message).toMatch(/slot 15\b/);
  });

  it("refuses a response missing a field the read needs, naming where", async () => {
    const withoutStatus = { ...leagueBody([]), status: undefined };
    const unnamedTeam = leagueBody([{ id: 4, roster: { entries: [] } }]);

    const missingField = await readFailure(readClientFor(withoutStatus).getLineups());
    const missingName = await readFailure(readClientFor(unnamedTeam).getLineups());

    expect(missingField.code).toBe("unrecognized_response");
    expect(missingField.message).toMatch(/status/);
    expect(missingField.cause).toBeInstanceOf(Error);
    expect(missingName.code).toBe("unrecognized_response");
    expect(missingName.message).toMatch(/team 4/);
  });
});

// The committed recording of the real league (`pnpm capture:espn`). Subjects are found by what
// they are, never by pinned ids, so a recapture doesn't break these.
describe("the recorded league", () => {
  const lineupKey = requestKey({ kind: "league", views: LINEUP_VIEWS });

  it("serves every team's lineup in stub mode, labelled as recorded with its capture time", async () => {
    const read = await createEspnClient({ mode: "stub" }).getLineups();

    expect(read.meta.source).toBe("recorded");
    expect(read.meta.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(read.teams).toHaveLength(12);
    for (const team of read.teams) {
      expect([team.starters.length, team.bench.length, team.injuredReserve.length]).toEqual([
        10, 4, 3,
      ]);
      expect(team.teamName).toMatch(/^Team \d+$/);
    }
  });

  it("reads a starter's OUT designation from the recorded shape", async () => {
    // A copy with one recorded starter marked OUT, so this doesn't depend on who was injured when
    // the league was captured.
    const recordings = await loadCommittedRecordings();
    const league = lineupResponseSchema.parse(recordings.responses.get(lineupKey));
    const starter = league.teams
      ?.flatMap((team) => team.roster?.entries ?? [])
      .find((entry) => entry.lineupSlotId !== 12 && entry.lineupSlotId !== 13);
    if (!starter) throw new Error("the recording has no starter");
    starter.playerPoolEntry.player.injuryStatus = "OUT";
    const derived: Recordings = {
      ...recordings,
      responses: new Map(recordings.responses).set(lineupKey, league),
    };

    const read = await createReadClient(createRecordedSource(async () => derived)).getLineups();

    const slot = read.teams
      .flatMap((team) => team.starters)
      .find((candidate) => candidate.player?.playerId === starter.playerId);
    expect(slot?.player?.designation).toEqual({ status: "OUT" });
  });

  it("matches the counts its manifest reports", async () => {
    const manifest: { scoringPeriodId: number; coverage: Record<string, number> } = JSON.parse(
      readFileSync(new URL("../../recordings/manifest.json", import.meta.url), "utf8")
    );

    const read = await createEspnClient({ mode: "stub" }).getLineups();

    const slots = read.teams.flatMap((team) => [
      ...team.starters,
      ...team.bench,
      ...team.injuredReserve,
    ]);
    expect(manifest.coverage).toMatchObject({
      teamCount: read.teams.length,
      playerCount: slots.filter((slot) => slot.player).length,
      outStarterCount: read.teams
        .flatMap((team) => team.starters)
        .filter((slot) => slot.player?.designation.status === "OUT").length,
      injuredReserveCount: read.teams
        .flatMap((team) => team.injuredReserve)
        .filter((slot) => slot.player).length,
    });
    expect(manifest.scoringPeriodId).toBe(read.meta.scoringPeriodId);
  });
});
