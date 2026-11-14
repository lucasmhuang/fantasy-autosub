import { z } from "zod";
import { EspnError } from "./errors";
import { parseResponse } from "./league";
import {
  communicationUrl,
  confirmSendableCredentials,
  createReadDeadline,
  type EspnCredentials,
  gameRootUrl,
  leagueViewUrl,
  readEspnJson,
} from "./request";
import { createSeasonCheck } from "./season";

// A record in ESPN's transaction log (mTransactions2): lineup and roster changes, whoever made
// them. Score adjustments never appear here; the activity feed carries them.
export type LeagueTransaction = {
  transactionId: string;
  type: string;
  // Null where ESPN sent none (an accepted trade, 2026-11-14).
  status: string | null;
  teamId: number;
  scoringPeriodId: number;
  // Made through ESPN's league-manager tools, by the app or by hand (M1).
  byLeagueManager: boolean;
  proposedAt: Date;
  items: TransactionItem[];
};

export type TransactionItem = {
  type: string;
  playerId: number;
  fromSlotId: number;
  toSlotId: number;
  fromTeamId: number;
  toTeamId: number;
};

// A score adjustment in the league's activity feed (message 247): only a league manager can make
// one. The totals are the adjusted side's, before and after, adjustment included.
export type FeedAdjustment = {
  messageId: string;
  at: Date;
  teamId: number;
  opponentTeamId: number;
  matchupId: number;
  totalBefore: number;
  totalAfter: number;
  reason: string;
};

// Any other league-manager change in the feed: a settings message, or a schedule message that
// isn't an adjustment (247) or the plain schedule write (138) every adjustment write posts.
export type FeedLeagueChange = {
  messageId: string;
  at: Date;
  topicType: string;
  messageTypeId: number;
};

export type LeagueActivity = { adjustments: FeedAdjustment[]; leagueChanges: FeedLeagueChange[] };

// The reads misuse detection makes (C2). Live ESPN only: none is recorded, since detection runs
// only against the real league.
export type EspnMonitoringClient = {
  getTransactions(scoringPeriodId: number): Promise<LeagueTransaction[]>;
  getLeagueActivity(range: { from: Date; to: Date }): Promise<LeagueActivity>;
  getLeaguePrivacy(): Promise<{ isPublic: boolean }>;
};

export type CreateMonitoringClientOptions = {
  season: number;
  leagueId: number;
  credentials: EspnCredentials;
  timeoutMs?: number;
};

const transactionItemSchema = z.object({
  type: z.string(),
  playerId: z.number().int(),
  fromLineupSlotId: z.number().int(),
  toLineupSlotId: z.number().int(),
  fromTeamId: z.number().int(),
  toTeamId: z.number().int(),
});
// ESPN leaves `items` off a declined or upheld trade and `status` off an accepted one (the live
// league, 2026-11-14: 11 of 836 records). What places a record (its id, type, team, day, time and
// whether a league manager made it) stays required, so a record detection can't place pauses the
// watch rather than going unseen.
const transactionSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().optional(),
  teamId: z.number().int(),
  scoringPeriodId: z.number().int(),
  isLeagueManager: z.boolean(),
  proposedDate: z.number(),
  items: z.array(transactionItemSchema).default([]),
});
// ESPN leaves `transactions` out on a day with none (2026's days 160-166, probed 2026-10-29).
const transactionsResponseSchema = z.object({
  transactions: z.array(transactionSchema).optional(),
});

const messageSchema = z.object({
  id: z.string(),
  date: z.number(),
  messageTypeId: z.number().int(),
});
const feedResponseSchema = z.object({
  topics: z.array(z.object({ type: z.string(), messages: z.array(z.unknown()) })),
});
// 247's `from` and `to` are the side's totals as text ("478.1"), `subject` its matchup id.
const decimalText = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);
const adjustmentMessageSchema = messageSchema.extend({
  for: z.number().int(),
  targetId: z.number().int(),
  subject: z.string().regex(/^\d+$/).transform(Number),
  from: decimalText,
  to: decimalText,
  content: z.string().default(""),
});
const privacyResponseSchema = z.object({ settings: z.object({ isPublic: z.boolean() }) });

const ADJUSTMENT_MESSAGE = 247;
// Every adjustment write posts this beside its 247, and alone when the value didn't change (B13),
// naming no team: it says nothing an adjustment's own message doesn't.
const SCHEDULE_WRITE_MESSAGE = 138;
const FEED_TOPICS = ["ACTIVITY_SCHEDULE", "ACTIVITY_SETTINGS"];
const FEED_PAGE_LIMIT = 50;
const MAX_FEED_PAGES = 20;

// One monitoring request: credentials checked, then the season, then the read itself.
function createMonitoringRead(options: CreateMonitoringClientOptions) {
  const checkSeason = createSeasonCheck(options.season, (signal) =>
    readEspnJson({ url: gameRootUrl(), readName: "the game root", signal })
  );
  return async (
    url: string,
    readName: string,
    signal: AbortSignal,
    headers?: Record<string, string>
  ) => {
    confirmSendableCredentials(options.credentials, readName);
    await checkSeason(signal);
    return readEspnJson({
      url,
      readName,
      signal,
      season: options.season,
      credentials: options.credentials,
      ...(headers === undefined ? {} : { headers }),
    });
  };
}

// Each read confirms the configured season is the one in progress first, as the league reads do,
// and has one deadline for all its requests.
export function createEspnMonitoringClient(
  options: CreateMonitoringClientOptions
): EspnMonitoringClient {
  const read = createMonitoringRead(options);
  const { season, leagueId } = options;
  return {
    async getTransactions(scoringPeriodId) {
      const readName = `mTransactions2 for day ${scoringPeriodId}`;
      const url = leagueViewUrl(season, leagueId, ["mTransactions2"], scoringPeriodId);
      const body = await read(url, readName, createReadDeadline(options.timeoutMs));
      const parsed = parseResponse(transactionsResponseSchema, body, readName);
      return (parsed.transactions ?? []).map(transactionOf);
    },
    async getLeagueActivity(range) {
      const signal = createReadDeadline(options.timeoutMs);
      const readPage = (offset: number) =>
        read(communicationUrl(season, leagueId), "the activity feed", signal, {
          "x-fantasy-filter": feedFilter(range, offset),
        });
      return activityOf(await readFeedTopics(readPage));
    },
    async getLeaguePrivacy() {
      const readName = "mSettings for the league's privacy";
      const url = leagueViewUrl(season, leagueId, ["mSettings"]);
      const body = await read(url, readName, createReadDeadline(options.timeoutMs));
      return { isPublic: parseResponse(privacyResponseSchema, body, readName).settings.isPublic };
    },
  };
}

function transactionOf(raw: z.infer<typeof transactionSchema>): LeagueTransaction {
  return {
    transactionId: raw.id,
    type: raw.type,
    status: raw.status ?? null,
    teamId: raw.teamId,
    scoringPeriodId: raw.scoringPeriodId,
    byLeagueManager: raw.isLeagueManager,
    proposedAt: new Date(raw.proposedDate),
    items: raw.items.map((item) => ({
      type: item.type,
      playerId: item.playerId,
      fromSlotId: item.fromLineupSlotId,
      toSlotId: item.toLineupSlotId,
      fromTeamId: item.fromTeamId,
      toTeamId: item.toTeamId,
    })),
  };
}

// The filter ESPN's own activity page sends, for these topics over the range, newest first.
function feedFilter(range: { from: Date; to: Date }, offset: number): string {
  return JSON.stringify({
    topics: {
      filterType: { value: FEED_TOPICS },
      filterDateRange: { value: range.from.getTime(), additionalValue: range.to.getTime() },
      limit: FEED_PAGE_LIMIT,
      limitPerMessageSet: { value: FEED_PAGE_LIMIT },
      offset,
      sortMessageDate: { sortPriority: 1, sortAsc: false },
      sortFor: { sortPriority: 2, sortAsc: false },
    },
  });
}

type FeedTopic = z.infer<typeof feedResponseSchema>["topics"][number];

// Pages as ESPN's own page does, by offset, until a page holds fewer topics than the limit.
async function readFeedTopics(readPage: (offset: number) => Promise<unknown>) {
  const topics: FeedTopic[] = [];
  for (let page = 0; page < MAX_FEED_PAGES; page += 1) {
    const body = await readPage(page * FEED_PAGE_LIMIT);
    const parsed = parseResponse(feedResponseSchema, body, "the activity feed");
    topics.push(...parsed.topics);
    if (parsed.topics.length < FEED_PAGE_LIMIT) return topics;
  }
  throw new EspnError(
    "unrecognized_response",
    `the activity feed holds more than ${MAX_FEED_PAGES * FEED_PAGE_LIMIT} topics in the range`
  );
}

function activityOf(topics: FeedTopic[]): LeagueActivity {
  const activity: LeagueActivity = { adjustments: [], leagueChanges: [] };
  for (const { type, messages } of topics) {
    for (const raw of messages) {
      const message = parseResponse(messageSchema, raw, "the activity feed");
      if (message.messageTypeId === ADJUSTMENT_MESSAGE) {
        activity.adjustments.push(adjustmentOf(raw));
      } else if (type === "ACTIVITY_SETTINGS" || message.messageTypeId !== SCHEDULE_WRITE_MESSAGE) {
        const { id, date, messageTypeId } = message;
        activity.leagueChanges.push({
          messageId: id,
          at: new Date(date),
          topicType: type,
          messageTypeId,
        });
      }
    }
  }
  return activity;
}

function adjustmentOf(raw: unknown): FeedAdjustment {
  const message = parseResponse(adjustmentMessageSchema, raw, "an adjustment in the activity feed");
  return {
    messageId: message.id,
    at: new Date(message.date),
    teamId: message.for,
    opponentTeamId: message.targetId,
    matchupId: message.subject,
    totalBefore: message.from,
    totalAfter: message.to,
    reason: message.content,
  };
}
