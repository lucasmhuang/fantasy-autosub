import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { subRequests } from "./requests";

// Declared twice, as each status and kind enum is: here, and in packages/domain
// (execution/espn-writes.ts); apps/worker's enum-pairs test pins each pair equal.
export const espnWriteKindEnum = pgEnum("espn_write_kind", ["lineup", "adjustment"]);
export const espnWriteStatusEnum = pgEnum("espn_write_status", [
  "sending",
  "answered",
  "failed",
  "recorded_only",
]);
export const espnWriteOutcomeEnum = pgEnum("espn_write_outcome", [
  "verified",
  "not_applied",
  "ambiguous",
]);

// The one lease every ESPN write runs under, across workers (two overlap during a deploy). Each
// takeover raises the token, and every send first checks it, so a worker that lost the lease
// sends nothing. The database's clock stamps it.
export const espnWriteLock = pgTable(
  "espn_write_lock",
  {
    lockId: integer("lock_id").primaryKey().default(1),
    holder: text("holder").notNull(),
    token: integer("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    singleRow: check("espn_write_lock_single_row", sql`${table.lockId} = 1`),
  })
);

// Every ESPN write attempt, committed before it is sent: in recovery, no row means nothing went.
export const espnWrites = pgTable(
  "espn_writes",
  {
    writeId: uuid("write_id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => subRequests.requestId),
    kind: espnWriteKindEnum("kind").notNull(),
    teamId: integer("team_id").notNull(),
    matchupId: integer("matchup_id"),
    scoringPeriodId: integer("scoring_period_id"),
    body: jsonb("body").notNull(),
    fencingToken: integer("fencing_token").notNull(),
    status: espnWriteStatusEnum("status").notNull().default("sending"),
    failureCode: text("failure_code"),
    outcome: espnWriteOutcomeEnum("outcome"),
    readback: jsonb("readback"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    readBackAt: timestamp("read_back_at", { withTimezone: true }),
  },
  (table) => ({
    requestIdIdx: index("espn_writes_request_id_idx").on(table.requestId),
  })
);
