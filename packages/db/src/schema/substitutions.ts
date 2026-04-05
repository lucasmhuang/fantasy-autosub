import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const requestStatusEnum = pgEnum("request_status", [
  "queued",
  "executing",
  "pending_review",
  "stale_requires_review",
  "fallback_required",
  "rejected",
  "executed",
  "failed",
  "reversed",
]);

export const executionModeEnum = pgEnum("execution_mode", ["auto_execute", "approval_required"]);

export const substitutionRequests = pgTable(
  "substitution_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    teamId: integer("team_id").notNull(),
    matchupPeriodId: integer("matchup_period_id").notNull(),
    executionMode: executionModeEnum("execution_mode").notNull(),
    status: requestStatusEnum("status").notNull(),
    injuredPlayerId: integer("injured_player_id").notNull(),
    replacementPlayerId: integer("replacement_player_id").notNull(),
    previewAdjustment: numeric("preview_adjustment", { precision: 8, scale: 1 }).notNull(),
    lineupResolution: jsonb("lineup_resolution").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamWeekIdx: index("substitution_requests_team_week_idx").on(
      table.teamId,
      table.matchupPeriodId
    ),
    statusIdx: index("substitution_requests_status_idx").on(table.status),
    createdAtIdx: index("substitution_requests_created_at_idx").on(table.createdAt),
  })
);

export const substitutionEvents = pgTable(
  "substitution_events",
  {
    eventId: uuid("event_id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => substitutionRequests.requestId, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requestIdIdx: index("substitution_events_request_id_idx").on(table.requestId),
    createdAtIdx: index("substitution_events_created_at_idx").on(table.createdAt),
  })
);

export const teamExecutionLeases = pgTable(
  "team_execution_leases",
  {
    leaseKey: text("lease_key").primaryKey(),
    teamId: integer("team_id").notNull(),
    matchupPeriodId: integer("matchup_period_id").notNull(),
    holderRequestId: uuid("holder_request_id")
      .notNull()
      .references(() => substitutionRequests.requestId, { onDelete: "cascade" }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    teamWeekIdx: index("team_execution_leases_team_week_idx").on(
      table.teamId,
      table.matchupPeriodId
    ),
    expiresAtIdx: index("team_execution_leases_expires_at_idx").on(table.expiresAt),
  })
);
