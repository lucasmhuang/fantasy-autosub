import { describe, expect, it } from "vitest";
import { createReadClient } from "./client";
import type { LineupSlot, LineupSlotName } from "./contracts";
import { EspnError } from "./errors";
import { LINEUP_VIEWS } from "./league";
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

describe("lineup reads", () => {
  it("reads every team's lineup: each starting slot, the bench and IR, empty slots included", async () => {
    const body = leagueBody([
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

    const read = await readClientFor(body).getLineups();

    const player = (playerId: number, designation: object, extra: object = {}) => ({
      playerId,
      name: `Player ${playerId}`,
      proTeamId: 9,
      eligibleSlots: ["C", "UTIL", "BE", "IR"],
      designation,
      lineupLocked: false,
      ...extra,
    });
    expect(read.meta).toEqual({
      source: "recorded",
      capturedAt: "2026-10-25T01:00:00.000Z",
      season: 2027,
      matchupPeriodId: 1,
      scoringPeriodId: 5,
      readAt: "2026-10-25T02:00:00.000Z",
    });
    expect(read.teams).toEqual([
      {
        teamId: 1,
        teamName: "Team 1",
        starters: [
          { slot: "C", player: player(101, { status: "OUT" }, { lineupLocked: true }) },
          {
            slot: "G",
            player: player(
              102,
              { status: "SUSPENSION" },
              { eligibleSlots: ["PG", "G", "G/F", "UTIL", "BE", "IR"] }
            ),
          },
          empty("G"),
          empty("G"),
          { slot: "F", player: player(103, { status: "unrecognized", raw: "QUESTIONABLE" }) },
          empty("F"),
          empty("F"),
          empty("F/C"),
          empty("UTIL"),
          empty("UTIL"),
        ],
        bench: [
          { slot: "BE", player: player(104, { status: "unrecognized", raw: null }) },
          empty("BE"),
          empty("BE"),
          empty("BE"),
        ],
        injuredReserve: [
          { slot: "IR", player: player(105, { status: "OUT" }) },
          empty("IR"),
          empty("IR"),
        ],
      },
      {
        teamId: 2,
        teamName: "Team 2",
        starters: ["C", "G", "G", "G", "F", "F", "F", "F/C", "UTIL", "UTIL"].map((slot) =>
          empty(slot as LineupSlotName)
        ),
        bench: [empty("BE"), empty("BE"), empty("BE"), empty("BE")],
        injuredReserve: [empty("IR"), empty("IR"), empty("IR")],
      },
    ]);
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
