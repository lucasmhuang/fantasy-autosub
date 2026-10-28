import { describe, expect, it } from "vitest";
import { EspnError } from "../read/errors";
import {
  checkRecordingShape,
  findDuplicateKeys,
  findIdentifyingValues,
  placeholderMemberId,
  type RecordingIdentities,
  scrubRecording,
} from "./scrub";

// Synthetic values only. No real member, team or league value ever belongs in this file.
const ownerId = "{A1B2C3D4-1111-4111-8111-0000000000AA}";
const rivalId = "{B1B2C3D4-2222-4222-8222-0000000000BB}";
const coOwnerId = "{C9C9C9C9-3333-4333-8333-0000000000C9}";
const strangerId = "{F1F2F3F4-6666-4666-8666-0000000000FF}";
const leagueId = 4567123;
const espnS2 = `AEB${"q".repeat(160)}%2Bsynthetic%3D`;

// Listed out of team order, with team ids that aren't 1 and 2, a co-owner who owns no team, and a
// team without a primary owner: placeholders follow the teams, not the list.
const identities: RecordingIdentities = {
  leagueId,
  leagueName: "Synthetic Hoops League",
  espnS2,
  members: [
    { id: coOwnerId, firstName: "Kit", lastName: "Marlowe", displayName: "kitm" },
    { id: rivalId, firstName: "Dana", lastName: "Rivers", displayName: "drivers" },
    { id: ownerId, firstName: "Anthony", lastName: "Q", displayName: "hoops_q" },
  ],
  teams: [
    {
      id: 7,
      name: "Q Dynasty",
      abbrev: "QDY",
      owners: [ownerId, coOwnerId],
      primaryOwner: ownerId,
    },
    { id: 3, name: "River City", abbrev: "RVC", owners: [rivalId] },
  ],
};

// Shaped like an ESPN league response with members, teams and rosters. The member "Anthony Q"
// shares a first name with the rostered player "Anthony Example", and has a one-letter last name.
function espnLeagueBody(): Record<string, unknown> {
  return {
    gameId: 3,
    id: leagueId,
    seasonId: 2027,
    segmentId: 0,
    scoringPeriodId: 5,
    settings: { name: "Synthetic Hoops League", size: 3 },
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
        isLeagueCreator: true,
        notificationSettings: [{ enabled: true, id: "{C1C2C3C4-3333-4333-8333-0000000000CC}" }],
      },
      { id: rivalId, firstName: "Dana", lastName: "Rivers", displayName: "drivers" },
      { id: coOwnerId, firstName: "Kit", lastName: "Marlowe", displayName: "kitm" },
    ],
    teams: [
      {
        id: 7,
        name: "Q Dynasty",
        abbrev: "QDY",
        location: "Q",
        nickname: "Dynasty",
        logo: "https://example.com/q-dynasty.png",
        logoType: "CUSTOM_VALID",
        owners: [ownerId, coOwnerId],
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
              playerPoolEntry: {
                id: 3001,
                status: "ONTEAM",
                player: { fullName: "Anthony Example", injuryStatus: "OUT" },
              },
            },
          ],
        },
      },
      {
        id: 3,
        name: "River City",
        abbrev: "RVC",
        location: "River",
        nickname: "City",
        owners: [rivalId],
        primaryOwner: rivalId,
        roster: { entries: [] },
      },
    ],
  };
}

// What a request schema might keep: none of ESPN's top-level ids.
function trimmedLeagueBody(): Record<string, unknown> {
  const body = espnLeagueBody();
  for (const key of ["gameId", "id", "seasonId", "segmentId", "scoringPeriodId"]) delete body[key];
  return body;
}

function uniquePaths(found: readonly { file: string; path: string }[]) {
  return [...new Set(found.map(({ file, path }) => `${file} ${path}`))].sort();
}

function sortedReports(found: readonly { file: string; path: string; kind: string }[]) {
  return [...found].sort((a, b) => `${a.path} ${a.kind}`.localeCompare(`${b.path} ${b.kind}`));
}

function thrownBy(action: () => unknown): EspnError {
  try {
    action();
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected an EspnError");
}

describe("scrubRecording", () => {
  it.each([
    ["an ESPN response", espnLeagueBody],
    ["a trimmed response, without ESPN's top-level ids", trimmedLeagueBody],
  ])("leaves no identifying value or private field in %s, and keeps the public data", (_, makeBody) => {
    const scrubbed = scrubRecording({ "league:mTeam": makeBody() }, identities);
    const files = { "league.json": scrubbed };

    expect(findIdentifyingValues(files, identities)).toEqual([]);
    expect(checkRecordingShape(files)).toEqual([]);
    expect(scrubbed).toMatchObject({
      "league:mTeam": {
        settings: { size: 3 },
        status: { currentMatchupPeriod: 1 },
        teams: [
          {
            id: 7,
            // The owner's lists stay as empty presence markers: the credential check reads them.
            watchList: [],
            pendingTransactions: [],
            roster: {
              entries: [
                {
                  playerId: 3001,
                  lineupSlotId: 0,
                  playerPoolEntry: {
                    id: 3001,
                    status: "ONTEAM",
                    player: { fullName: "Anthony Example", injuryStatus: "OUT" },
                  },
                },
              ],
            },
          },
          { id: 3, roster: { entries: [] } },
        ],
      },
    });
  });

  it("numbers each member after the team they own, the same way in every call", () => {
    const [owner, rival, coOwner] = [
      placeholderMemberId(7),
      placeholderMemberId(3),
      placeholderMemberId(8),
    ];

    const league = scrubRecording({ "league:mTeam": espnLeagueBody() }, identities);
    const day = scrubRecording({ "day:5": { teams: espnLeagueBody().teams } }, identities);

    expect(league).toMatchObject({
      "league:mTeam": {
        members: [
          { id: owner, firstName: "Member", lastName: "7", displayName: "member-7" },
          { id: rival, firstName: "Member", lastName: "3", displayName: "member-3" },
          { id: coOwner, firstName: "Member", lastName: "8", displayName: "member-8" },
        ],
        teams: [
          { id: 7, name: "Team 7", abbrev: "T7", owners: [owner, coOwner], primaryOwner: owner },
          { id: 3, name: "Team 3", abbrev: "T3", owners: [rival], primaryOwner: rival },
        ],
      },
    });
    expect(day).toMatchObject({
      "day:5": { teams: [{ owners: [owner, coOwner] }, { owners: [rival] }] },
    });
  });

  it("keeps only a member's known fields", () => {
    const member = {
      id: ownerId,
      firstName: "Anthony",
      lastName: "Q",
      displayName: "hoops_q",
      isLeagueCreator: true,
      email: "hoops@example.com",
      avatarUrl: "https://example.com/u/7731.jpg",
    };

    expect(scrubRecording({ league: { members: [member] } }, identities)).toEqual({
      league: {
        members: [
          {
            id: placeholderMemberId(7),
            firstName: "Member",
            lastName: "7",
            displayName: "member-7",
            isLeagueCreator: true,
          },
        ],
      },
    });
  });

  it("replaces a member's id wherever it appears: as a key, without braces or dashes, in any case", () => {
    const dashless = ownerId.replace(/[{}-]/g, "");
    const body = {
      notes: {
        [ownerId]: "keyed by the owner",
        plain: `owned by ${ownerId.slice(1, -1).toLowerCase()}`,
        compact: `see ${dashless}`,
      },
    };
    const placeholder = placeholderMemberId(7);

    const scrubbed = scrubRecording({ league: body }, identities);

    expect(scrubbed).toEqual({
      league: {
        notes: {
          [placeholder]: "keyed by the owner",
          plain: `owned by ${placeholder.slice(1, -1)}`,
          compact: `see ${placeholder.replace(/[{}-]/g, "")}`,
        },
      },
    });
  });

  it("refuses identities too incomplete to check against, and bodies that aren't objects", () => {
    const unlistedOwner = {
      ...identities,
      teams: [{ id: 7, name: "Q Dynasty", abbrev: "QDY", owners: [strangerId] }],
    };
    const failures = [
      thrownBy(() => scrubRecording({ league: espnLeagueBody() }, { ...identities, members: [] })),
      thrownBy(() => scrubRecording({ league: espnLeagueBody() }, unlistedOwner)),
      thrownBy(() => scrubRecording({ league: JSON.stringify(espnLeagueBody()) }, identities)),
      thrownBy(() =>
        scrubRecording({ league: { members: [{ id: strangerId, firstName: "Una" }] } }, identities)
      ),
      thrownBy(() => findIdentifyingValues({ "league.json": "{}" }, identities)),
      thrownBy(() => checkRecordingShape({ "league.json": "{}" })),
    ];

    for (const failure of failures) {
      expect(failure.code).toBe("unrecognized_response");
      expect(failure.message).not.toMatch(/F1F2F3F4|Una|Anthony|Synthetic/i);
    }
  });
});

describe("findIdentifyingValues", () => {
  it("matches a member's full name only as whole words, so players named like a member pass", () => {
    const files = {
      "days.json": {
        "day:5": { a: "Anthony Example", b: "Anthony Quill", c: "Anthony Q traded" },
      },
    };

    expect(findIdentifyingValues(files, identities)).toEqual([
      { file: "days.json", path: '$["day:5"].c', kind: "member full name" },
    ]);
  });

  it("reports each identifying value by file, path and kind, never the value", () => {
    const planted = {
      firstName: "anthony",
      padded: "  Dana  ",
      surname: "Q",
      handle: "https://example.com/u/hoops_q",
      spaced: "Dana   Rivers",
      team: "Q Dynasty clinched",
      abbrev: "QDY",
      league: "Synthetic Hoops League 2027",
      owner: `owned by ${ownerId.toLowerCase()}`,
      compact: `see ${ownerId.replace(/[{}-]/g, "")}`,
      leagueNumber: leagueId,
      leagueInUrl: `https://example.com/leagues/${leagueId}/home`,
      cookie: `espn_s2=${espnS2}`,
      decodedCookie: decodeURIComponent(espnS2),
      [rivalId]: true,
      "Una Listed": { note: "Anthony Q" },
    };

    const found = findIdentifyingValues({ "league.json": { planted } }, identities);

    const at = (path: string, kind: string) => ({
      file: "league.json",
      path: `$.planted${path}`,
      kind,
    });
    expect(sortedReports(found)).toEqual(
      sortedReports([
        at(".firstName", "member name"),
        at(".padded", "member name"),
        at(".surname", "member name"),
        at(".handle", "display name"),
        at(".spaced", "member full name"),
        at(".team", "team name"),
        at(".abbrev", "team abbreviation"),
        at(".league", "league name"),
        at(".owner", "member id"),
        at(".compact", "member id"),
        at(".leagueNumber", "league id"),
        at(".leagueInUrl", "league id"),
        at(".cookie", "espn_s2"),
        at(".decodedCookie", "espn_s2"),
        at("[<identifying key>]", "member id"),
        at("[<key>].note", "member full name"),
      ])
    );
  });
});

describe("checkRecordingShape", () => {
  it("reports every value and field a public recording must not hold, wherever the schema left it", () => {
    const files = {
      "league.json": {
        "league:mTeam": {
          id: leagueId,
          settings: { name: "Some League" },
          status: { creationInfo: { source: strangerId } },
          members: [
            {
              id: strangerId,
              firstName: "Dana",
              lastName: "Rivers",
              displayName: "drivers",
              notificationSettings: [],
              email: "dana@example.com",
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
              tradeStrategy: {},
              roster: { entries: [{ playerId: 3001, pendingTransactionIds: ["x"] }] },
            },
            {
              id: 2,
              name: "Team 2",
              abbrev: "T2",
              owners: [placeholderMemberId(2)],
              roster: { entries: [] },
            },
          ],
          note: `cookie ${"A".repeat(120)}`,
          compact: `see ${strangerId.replace(/[{}-]/g, "")}`,
          clientAddress: { ip: "203.0.113.7" },
          futureKeeperPlayerIds: [],
          [strangerId]: 1,
          ["B".repeat(120)]: 1,
          "Una Listed": { note: strangerId },
        },
      },
    };

    const at = (path: string) => `league.json $["league:mTeam"]${path}`;
    expect(uniquePaths(checkRecordingShape(files))).toEqual(
      [
        at(".id"),
        at(".settings.name"),
        at(".status.creationInfo"),
        at(".status.creationInfo.source"),
        at(".members[0].id"),
        at(".members[0].firstName"),
        at(".members[0].lastName"),
        at(".members[0].displayName"),
        at(".members[0].notificationSettings"),
        at(".members[0].email"),
        at(".teams"),
        at(".teams[0].name"),
        at(".teams[0].abbrev"),
        at(".teams[0].logo"),
        at(".teams[0].watchList"),
        at(".teams[0].draftStrategy"),
        at(".teams[0].draftStrategy.draftList"),
        at(".teams[0].roster.entries[0].pendingTransactionIds"),
        at(".note"),
        at(".compact"),
        at(".clientAddress"),
        at(".futureKeeperPlayerIds"),
        at("[<key>]"),
        at("[<key>].note"),
      ].sort()
    );
  });

  // The hooks and CI print each problem, so it says what kind of value it found, never the value.
  it("names the kind of value it found, and never the value itself", () => {
    const cookieShaped = "A".repeat(120);
    const files = {
      "league.json": {
        "league:mTeam": {
          id: leagueId,
          members: [{ id: strangerId, firstName: "Dana" }],
          teams: [
            {
              id: 1,
              name: "River City",
              owners: [placeholderMemberId(1)],
              watchList: [3001],
              draftStrategy: {},
            },
          ],
          note: `cookie ${cookieShaped}`,
          compact: `see ${strangerId}`,
        },
      },
    };

    const problems = checkRecordingShape(files);

    const found = (path: string, kind: RegExp) => ({
      file: "league.json",
      path: `$["league:mTeam"]${path}`,
      problem: expect.stringMatching(kind),
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        found(".id", /league id/),
        found(".members[0].id", /member id/),
        found(".compact", /member id/),
        found(".note", /espn_s2 cookie/),
        found(".teams[0].watchList", /watchList/),
        found(".teams[0].draftStrategy", /draftStrategy/),
        found(".members[0].firstName", /firstName.*placeholder/),
        found(".teams[0].name", /\bname\b.*placeholder/),
      ])
    );
    expect(problems.filter(({ problem }) => problem.trim() === "")).toEqual([]);
    const printed = JSON.stringify(problems);
    const values = [String(leagueId), strangerId, "Dana", "River City", cookieShaped];
    expect(values.filter((value) => printed.includes(value))).toEqual([]);
  });
});

describe("findDuplicateKeys", () => {
  it("finds a key repeated within one nested object, by its path", () => {
    const text = '{"league:mTeam": {"teams": [{"id": 1, "name": "Team 1", "name": "Team 2"}]}}';

    expect(findDuplicateKeys(text)).toEqual(['$["league:mTeam"].teams[0].name']);
  });

  it("allows the same key in sibling objects, and in each object of a list", () => {
    const text = '{"a": {"id": 1}, "b": {"id": 1}, "list": [{"id": 1}, {"id": 2}]}';

    expect(findDuplicateKeys(text)).toEqual([]);
  });

  it("ignores keys inside strings, escaped quotes and backslashes included", () => {
    const text = String.raw`{"note": "{\"id\": 1, \"id\": 2}", "path": "C:\\", "id": 1}`;

    expect(findDuplicateKeys(text)).toEqual([]);
  });

  // JSON.parse reads an escaped key as the key it spells, so a repeat can hide behind an escape.
  it("finds a repeat spelled with an escape", () => {
    expect(findDuplicateKeys(String.raw`{"id": 1, "\u0069d": 2}`)).toEqual(["$.id"]);
  });

  it("shows a key it can't print as [<key>]", () => {
    expect(findDuplicateKeys('{"a b": 1, "a b": 2}')).toEqual(["$[<key>]"]);
  });

  it("reports where, never a value, nor a key that is one", () => {
    const dashless = strangerId.replace(/[{}-]/g, "");
    const text = `{"members": [{"id": "${strangerId}", "id": "${placeholderMemberId(1)}"}], "${dashless}": 1, "${dashless}": 2}`;

    expect(findDuplicateKeys(text)).toEqual(["$.members[0].id", "$[<key>]"]);
  });
});
