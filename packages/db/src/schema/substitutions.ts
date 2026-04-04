import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const substitutionRequests = pgTable("substitution_requests", {
  requestId: uuid("request_id").primaryKey(),
  teamId: integer("team_id").notNull(),
  matchupPeriodId: integer("matchup_period_id").notNull(),
  executionMode: executionModeEnum("execution_mode").notNull(),
  status: requestStatusEnum("status").notNull(),
  injuredPlayerId: integer("injured_player_id").notNull(),
  replacementPlayerId: integer("replacement_player_id").notNull(),
  previewAdjustment: text("preview_adjustment").notNull(),
  lineupResolution: jsonb("lineup_resolution").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const substitutionEvents = pgTable("substitution_events", {
  eventId: uuid("event_id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  actorType: text("actor_type").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const teamExecutionLeases = pgTable("team_execution_leases", {
  leaseKey: text("lease_key").primaryKey(),
  teamId: integer("team_id").notNull(),
  matchupPeriodId: integer("matchup_period_id").notNull(),
  holderRequestId: uuid("holder_request_id").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
