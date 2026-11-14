import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EspnError } from "./errors";
import { createEspnMonitoringClient } from "./monitoring";

// Synthetic values only, shaped like the 2026-10-29 and 2026-11-13 probes' raw answers. No real
// member, team or league value belongs in this file.
const LEAGUE_ID = 424242;
const credentials = { espnS2: "invented-s2", swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}" };
const ownerMember = "{A1B2C3D4-1111-4111-8111-0000000000AA}";
const managerMember = "{B1B2C3D4-2222-4222-8222-0000000000BB}";

type Sent = { url: URL; headers: Headers };
let sent: Sent[] = [];
let answer: (url: URL) => { status: number; body: unknown };

beforeEach(() => {
  sent = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    sent.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname.endsWith("/games/fba")) return Response.json({ currentSeasonId: 2027 });
    const { status, body } = answer(url);
    return Response.json(body, { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function client() {
  return createEspnMonitoringClient({ season: 2027, leagueId: LEAGUE_ID, credentials });
}

const lmLineupEdit = {
  id: "0b6c1d52-0000-4000-8000-000000000001",
  type: "ROSTER",
  status: "EXECUTED",
  executionType: "EXECUTE",
  isLeagueManager: true,
  isActingAsTeamOwner: false,
  isPending: false,
  memberId: ownerMember,
  teamId: 8,
  scoringPeriodId: 26,
  proposedDate: Date.parse("2026-11-15T20:00:00.000Z"),
  bidAmount: 0,
  rating: 0,
  items: [
    {
      type: "LINEUP",
      playerId: 4277905,
      fromLineupSlotId: 10,
      toLineupSlotId: 12,
      fromTeamId: 0,
      toTeamId: 0,
      isKeeper: false,
      overallPickNumber: 0,
    },
    {
      type: "LINEUP",
      playerId: 4397002,
      fromLineupSlotId: 12,
      toLineupSlotId: 10,
      fromTeamId: 0,
      toTeamId: 0,
      isKeeper: false,
      overallPickNumber: 0,
    },
  ],
};
const managerMove = {
  ...lmLineupEdit,
  id: "0b6c1d52-0000-4000-8000-000000000002",
  isLeagueManager: false,
  memberId: managerMember,
  teamId: 3,
  proposedDate: Date.parse("2026-11-15T21:00:00.000Z"),
};

describe("the transaction log read", () => {
  it("lists a day's records from mTransactions2, the league manager's marked", async () => {
    answer = () => ({
      status: 200,
      body: { id: LEAGUE_ID, scoringPeriodId: 26, transactions: [lmLineupEdit, managerMove] },
    });

    const transactions = await client().getTransactions(26);

    const read = sent.at(-1);
    expect(read?.url.searchParams.getAll("view")).toEqual(["mTransactions2"]);
    expect(read?.url.searchParams.get("scoringPeriodId")).toBe("26");
    expect(read?.headers.get("cookie")).toContain("espn_s2=invented-s2");
    expect(transactions).toEqual([
      {
        transactionId: lmLineupEdit.id,
        type: "ROSTER",
        status: "EXECUTED",
        teamId: 8,
        scoringPeriodId: 26,
        byLeagueManager: true,
        proposedAt: new Date("2026-11-15T20:00:00.000Z"),
        items: [
          {
            type: "LINEUP",
            playerId: 4277905,
            fromSlotId: 10,
            toSlotId: 12,
            fromTeamId: 0,
            toTeamId: 0,
          },
          {
            type: "LINEUP",
            playerId: 4397002,
            fromSlotId: 12,
            toSlotId: 10,
            fromTeamId: 0,
            toTeamId: 0,
          },
        ],
      },
      expect.objectContaining({ transactionId: managerMove.id, byLeagueManager: false }),
    ]);
    expect(JSON.stringify(transactions)).not.toContain("A1B2C3D4");
  });

  // ESPN leaves the key out on a day with no records, rather than sending [].
  it("reads a day without records as none", async () => {
    answer = () => ({ status: 200, body: { id: LEAGUE_ID, scoringPeriodId: 27 } });

    expect(await client().getTransactions(27)).toEqual([]);
  });

  it("fails a refused cookie as credentials_rejected", async () => {
    answer = () => ({ status: 401, body: { details: [{ type: "AUTH_LEAGUE_NOT_VISIBLE" }] } });

    const failure = await client()
      .getTransactions(26)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EspnError);
    expect((failure as EspnError).code).toBe("credentials_rejected");
  });
});

function topic(type: string, at: string, messages: Record<string, unknown>[], id = at) {
  const date = Date.parse(at);
  return {
    id: `topic-${id}`,
    type,
    date,
    dateEdited: date,
    author: ownerMember,
    totalMessageCount: messages.length,
    messages: messages.map((message, index) => ({
      id: `message-${id}-${index}`,
      author: ownerMember,
      date: date + 29,
      isAlternateFormat: false,
      isDeleted: false,
      isEdited: false,
      topicId: `topic-${id}`,
      ...message,
    })),
  };
}

const adjustmentTopic = topic("ACTIVITY_SCHEDULE", "2026-11-15T22:00:00.000Z", [
  {
    messageTypeId: 247,
    for: 5,
    targetId: 6,
    subject: "29",
    from: "478.1",
    to: "483.2",
    content: "Injury sub requested Sun 11/15, 1:00 PM PT: A for B, +5.1",
  },
  { messageTypeId: 138 },
]);
const settingsTopic = topic("ACTIVITY_SETTINGS", "2026-11-15T23:00:00.000Z", [
  { messageTypeId: 154 },
]);

describe("the activity feed read", () => {
  const range = {
    from: new Date("2026-11-14T08:00:00.000Z"),
    to: new Date("2026-11-16T08:00:00.000Z"),
  };

  it("reads adjustments and other league changes, filtered to schedule and settings topics", async () => {
    answer = () => ({ status: 200, body: { topics: [adjustmentTopic, settingsTopic] } });

    const activity = await client().getLeagueActivity(range);

    const read = sent.at(-1);
    expect(read?.url.pathname).toMatch(/\/leagues\/424242\/communication\/$/);
    expect(read?.url.searchParams.get("view")).toBe("kona_league_communication");
    const filter = JSON.parse(read?.headers.get("x-fantasy-filter") ?? "{}");
    expect(filter.topics.filterType.value).toEqual(["ACTIVITY_SCHEDULE", "ACTIVITY_SETTINGS"]);
    expect(filter.topics.filterDateRange).toEqual({
      value: range.from.getTime(),
      additionalValue: range.to.getTime(),
    });
    expect(filter.topics.offset).toBe(0);
    expect(activity).toEqual({
      adjustments: [
        {
          messageId: "message-2026-11-15T22:00:00.000Z-0",
          at: new Date("2026-11-15T22:00:00.029Z"),
          teamId: 5,
          opponentTeamId: 6,
          matchupId: 29,
          totalBefore: 478.1,
          totalAfter: 483.2,
          reason: "Injury sub requested Sun 11/15, 1:00 PM PT: A for B, +5.1",
        },
      ],
      leagueChanges: [
        {
          messageId: "message-2026-11-15T23:00:00.000Z-0",
          at: new Date("2026-11-15T23:00:00.029Z"),
          topicType: "ACTIVITY_SETTINGS",
          messageTypeId: 154,
        },
      ],
    });
  });

  it("reads every page, until one holds fewer topics than the limit", async () => {
    const topics = Array.from({ length: 51 }, (_, index) =>
      topic("ACTIVITY_SETTINGS", "2026-11-15T23:00:00.000Z", [{ messageTypeId: 153 }], `${index}`)
    );
    answer = (url) => {
      const filter = JSON.parse(sent.at(-1)?.headers.get("x-fantasy-filter") ?? "{}");
      const { offset, limit } = filter.topics;
      expect(url.pathname).toMatch(/communication/);
      return { status: 200, body: { topics: topics.slice(offset, offset + limit) } };
    };

    const activity = await client().getLeagueActivity(range);

    const offsets = sent
      .filter(({ url }) => url.pathname.endsWith("/communication/"))
      .map(({ headers }) => JSON.parse(headers.get("x-fantasy-filter") ?? "{}").topics.offset);
    expect(offsets).toEqual([0, 50]);
    expect(activity.leagueChanges).toHaveLength(51);
  });

  it("refuses an adjustment whose totals or matchup aren't numbers", async () => {
    const unreadable = topic("ACTIVITY_SCHEDULE", "2026-11-15T22:00:00.000Z", [
      { messageTypeId: 247, for: 5, targetId: 6, subject: "29", from: "n/a", to: "483.2" },
    ]);
    answer = () => ({ status: 200, body: { topics: [unreadable] } });

    const failure = await client()
      .getLeagueActivity(range)
      .catch((error: unknown) => error);

    expect((failure as EspnError).code).toBe("unrecognized_response");
  });
});

describe("the league privacy read", () => {
  it.each([true, false])("reads isPublic (%s) from the league's settings", async (isPublic) => {
    answer = () => ({ status: 200, body: { id: LEAGUE_ID, settings: { isPublic } } });

    expect(await client().getLeaguePrivacy()).toEqual({ isPublic });
    expect(sent.at(-1)?.url.searchParams.getAll("view")).toEqual(["mSettings"]);
  });
});
