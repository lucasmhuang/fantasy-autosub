import { describe, expect, it } from "vitest";
import {
  checkRecordingShape,
  findIdentifyingValues,
  placeholderMemberId,
  type RecordingIdentities,
  scrubRecording,
} from "./scrub";

// Synthetic values only. No real member, team or league value ever belongs in this file.
const ownerId = "{A1B2C3D4-1111-4111-8111-0000000000AA}";
const rivalId = "{B1B2C3D4-2222-4222-8222-0000000000BB}";
const leagueId = 4567123;
const espnS2 = `AEB${"q".repeat(160)}%2Bsynthetic%3D`;

const identities: RecordingIdentities = {
  leagueId,
  leagueName: "Synthetic Hoops League",
  espnS2,
  members: [
    { id: ownerId, firstName: "Anthony", lastName: "Q", displayName: "hoops_q" },
    { id: rivalId, firstName: "Dana", lastName: "Rivers", displayName: "drivers" },
  ],
  teams: [
    { id: 1, name: "Q Dynasty", abbrev: "QDY", owners: [ownerId], primaryOwner: ownerId },
    { id: 2, name: "River City", abbrev: "RVC", owners: [rivalId], primaryOwner: rivalId },
  ],
};

// Shaped like an ESPN league response that carries members, teams and rosters. The member
// "Anthony Q" shares a first name with the rostered player "Anthony Example", and has a one-letter
// last name.
function leagueBody() {
  return {
    gameId: 3,
    id: leagueId,
    seasonId: 2027,
    segmentId: 0,
    scoringPeriodId: 5,
    settings: { name: "Synthetic Hoops League", size: 2 },
    status: {
      currentMatchupPeriod: 1,
      creationInfo: { clientAddress: null, platform: "web", source: ownerId },
      lastUpdateInfo: { clientAddress: null, platform: "web", source: rivalId },
    },
    members: [
      {
        id: ownerId,
        firstName: "Anthony",
        lastName: "Q",
        displayName: "hoops_q",
        notificationSettings: [{ enabled: true, id: "{C1C2C3C4-3333-4333-8333-0000000000CC}" }],
      },
      {
        id: rivalId,
        firstName: "Dana",
        lastName: "Rivers",
        displayName: "drivers",
        notificationSettings: [],
      },
    ],
    teams: [
      {
        id: 1,
        name: "Q Dynasty",
        abbrev: "QDY",
        logo: "https://example.com/q-dynasty.png",
        logoType: "CUSTOM_VALID",
        owners: [ownerId],
        primaryOwner: ownerId,
        watchList: [3001, 3002],
        pendingTransactions: [
          { bidAmount: 7, id: "{D1D2D3D4-4444-4444-8444-0000000000DD}", memberId: ownerId },
        ],
        draftStrategy: { draftList: [3001], futureKeeperPlayerIds: [] },
        roster: {
          entries: [
            {
              playerId: 3001,
              lineupSlotId: 0,
              pendingTransactionIds: ["{E1E2E3E4-5555-4555-8555-0000000000EE}"],
              playerPoolEntry: { player: { fullName: "Anthony Example", injuryStatus: "OUT" } },
            },
          ],
        },
      },
      {
        id: 2,
        name: "River City",
        abbrev: "RVC",
        owners: [rivalId],
        primaryOwner: rivalId,
        roster: { entries: [] },
      },
    ],
  };
}

function paths(found: readonly { file: string; path: string }[]) {
  return found.map(({ file, path }) => `${file} ${path}`).sort();
}

describe("scrubRecording", () => {
  it("leaves no identifying value or private field, and keeps the public data", () => {
    const scrubbed = scrubRecording({ "league:mTeam": leagueBody() }, identities);
    const files = { "league.json": scrubbed };

    expect(findIdentifyingValues(files, identities)).toEqual([]);
    expect(checkRecordingShape(files)).toEqual([]);
    expect(scrubbed).toMatchObject({
      "league:mTeam": {
        seasonId: 2027,
        scoringPeriodId: 5,
        status: { currentMatchupPeriod: 1 },
        teams: [
          {
            id: 1,
            roster: {
              entries: [
                {
                  playerId: 3001,
                  lineupSlotId: 0,
                  playerPoolEntry: { player: { fullName: "Anthony Example", injuryStatus: "OUT" } },
                },
              ],
            },
          },
          { id: 2, roster: { entries: [] } },
        ],
      },
    });
  });

  it("gives a member the same placeholder in every file, numbered after the team they own", () => {
    const owner = placeholderMemberId(1);
    const rival = placeholderMemberId(2);

    const league = scrubRecording({ "league:mTeam": leagueBody() }, identities);
    const days = scrubRecording({ "day:5": { ...leagueBody(), members: [] } }, identities);

    expect(league).toMatchObject({
      "league:mTeam": {
        members: [
          { id: owner, firstName: "Member", lastName: "1", displayName: "member-1" },
          { id: rival, firstName: "Member", lastName: "2", displayName: "member-2" },
        ],
        teams: [
          { id: 1, name: "Team 1", abbrev: "T1", owners: [owner], primaryOwner: owner },
          { id: 2, name: "Team 2", abbrev: "T2", owners: [rival], primaryOwner: rival },
        ],
      },
    });
    expect(days).toMatchObject({
      "day:5": { teams: [{ owners: [owner] }, { owners: [rival] }] },
    });
    expect(owner).not.toBe(rival);
  });
});

describe("findIdentifyingValues", () => {
  it("doesn't mistake a member's first name inside a player's full name for the member", () => {
    const files = {
      "days.json": {
        "day:5": {
          teams: [
            {
              roster: {
                entries: [{ playerPoolEntry: { player: { fullName: "Anthony Example" } } }],
              },
            },
          ],
        },
      },
    };

    expect(findIdentifyingValues(files, identities)).toEqual([]);
  });

  it("reports each identifying value by file, path and kind, without the value", () => {
    const planted = {
      firstName: "anthony",
      surname: "Q",
      handle: "HOOPS_Q",
      note: "traded by Anthony Q yesterday",
      team: "q dynasty",
      abbrev: "QDY",
      league: "Synthetic Hoops League",
      owner: `owned by ${ownerId.toLowerCase()}`,
      leagueNumber: leagueId,
      leagueInUrl: `https://example.com/leagues/${leagueId}/home`,
      cookie: `espn_s2=${espnS2}`,
      [rivalId]: true,
    };

    const found = findIdentifyingValues({ "league.json": { planted } }, identities);

    expect(found).toEqual([
      { file: "league.json", path: "$.planted.firstName", kind: "member name" },
      { file: "league.json", path: "$.planted.surname", kind: "member name" },
      { file: "league.json", path: "$.planted.handle", kind: "display name" },
      { file: "league.json", path: "$.planted.note", kind: "member full name" },
      { file: "league.json", path: "$.planted.team", kind: "team name" },
      { file: "league.json", path: "$.planted.abbrev", kind: "team abbreviation" },
      { file: "league.json", path: "$.planted.league", kind: "league name" },
      { file: "league.json", path: "$.planted.owner", kind: "member id" },
      { file: "league.json", path: "$.planted.leagueNumber", kind: "league id" },
      { file: "league.json", path: "$.planted.leagueInUrl", kind: "league id" },
      { file: "league.json", path: "$.planted.cookie", kind: "espn_s2" },
      { file: "league.json", path: "$.planted[<identifying key>]", kind: "member id" },
    ]);
    const report = JSON.stringify(found).toLowerCase();
    for (const value of [
      "anthony",
      "hoops_q",
      "rivers",
      "dynasty",
      "qdy",
      "synthetic",
      "a1b2c3d4",
    ]) {
      expect(report).not.toContain(value);
    }
    expect(report).not.toContain(rivalId.toLowerCase());
    expect(report).not.toContain(String(leagueId));
  });
});

describe("checkRecordingShape", () => {
  it("reports every value and field a public recording must not hold", () => {
    const files = {
      "league.json": {
        "league:mTeam": {
          id: leagueId,
          seasonId: 2027,
          segmentId: 0,
          settings: { name: "Some League" },
          status: { creationInfo: { source: "{F1F2F3F4-6666-4666-8666-0000000000FF}" } },
          members: [
            {
              id: "{F1F2F3F4-6666-4666-8666-0000000000FF}",
              firstName: "Dana",
              lastName: "Rivers",
              displayName: "drivers",
              notificationSettings: [],
            },
          ],
          teams: [
            {
              id: 1,
              name: "River City",
              abbrev: "RVC",
              logo: "https://example.com/logo.png",
              owners: [placeholderMemberId(1)],
              watchList: [3001],
              pendingTransactions: [],
              draftStrategy: { draftList: [] },
              roster: { entries: [{ playerId: 3001, pendingTransactionIds: ["x"] }] },
            },
          ],
          note: `cookie ${"A".repeat(120)}`,
        },
      },
    };

    expect(paths(checkRecordingShape(files))).toEqual(
      [
        '$["league:mTeam"].id',
        '$["league:mTeam"].settings.name',
        '$["league:mTeam"].status.creationInfo',
        '$["league:mTeam"].status.creationInfo.source',
        '$["league:mTeam"].members[0].id',
        '$["league:mTeam"].members[0].firstName',
        '$["league:mTeam"].members[0].lastName',
        '$["league:mTeam"].members[0].displayName',
        '$["league:mTeam"].members[0].notificationSettings',
        '$["league:mTeam"].teams[0].name',
        '$["league:mTeam"].teams[0].abbrev',
        '$["league:mTeam"].teams[0].logo',
        '$["league:mTeam"].teams[0].watchList',
        '$["league:mTeam"].teams[0].draftStrategy',
        '$["league:mTeam"].teams[0].draftStrategy.draftList',
        '$["league:mTeam"].teams[0].roster.entries[0].pendingTransactionIds',
        '$["league:mTeam"].note',
      ]
        .map((path) => `league.json ${path}`)
        .sort()
    );
  });

  it("accepts the placeholders, and lists that are present but empty", () => {
    const files = {
      "league.json": {
        "league:mTeam": {
          id: 0,
          seasonId: 2027,
          segmentId: 0,
          settings: { name: "Recorded League" },
          members: [
            {
              id: placeholderMemberId(1),
              firstName: "Member",
              lastName: "1",
              displayName: "member-1",
            },
          ],
          teams: [
            {
              id: 1,
              name: "Team 1",
              abbrev: "T1",
              owners: [placeholderMemberId(1)],
              watchList: [],
              pendingTransactions: [],
              roster: { entries: [{ playerId: 3001, pendingTransactionIds: [] }] },
            },
          ],
        },
      },
    };

    expect(checkRecordingShape(files)).toEqual([]);
  });
});
