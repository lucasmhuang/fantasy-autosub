import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userAccounts } from "./auth";

// Declared twice, as each status, role and mode enum is: here, and in packages/domain
// (requests/lifecycle.ts, requests/events.ts, requests/routing.ts); apps/worker's enum-pairs test
// pins each pair equal. Prefixed, since the scaffold owns request_status and execution_mode
// until it is dropped.
export const subRequestKindEnum = pgEnum("sub_request_kind", [
  "substitution",
  "on_behalf",
  "proving",
]);

export const subRequestStatusEnum = pgEnum("sub_request_status", [
  "refused",
  "awaiting_approval",
  "queued",
  "executing",
  "needs_review",
  "completed",
  "completed_manually",
  "rejected",
  "withdrawn",
  "reversed",
]);

export const subRequestReviewReasonEnum = pgEnum("sub_request_review_reason", [
  "automation_off",
  "not_allowlisted",
  "rearrangement",
  "suspension",
  "stale",
  "ambiguous",
  "lineup_failed",
  "adjustment_failed",
  "adjustment_held_rules",
  "adjustment_changed",
  "expired",
  "week_ended",
  "playoffs",
]);

export const subRequestLineupStateEnum = pgEnum("sub_request_lineup_state", [
  "pending",
  "sent",
  "verified",
  "ambiguous",
  "failed",
]);

export const subRequestAdjustmentStateEnum = pgEnum("sub_request_adjustment_state", [
  "not_owed",
  "pending",
  "held",
  "sent",
  "verified",
  "failed",
]);

export const leagueExecutionModeEnum = pgEnum("league_execution_mode", [
  "approval_required",
  "auto",
]);

export const subRequestActorTypeEnum = pgEnum("sub_request_actor_type", [
  "manager",
  "commissioner",
  "system",
]);

export const subRequestSnapshotPhaseEnum = pgEnum("sub_request_snapshot_phase", [
  "request",
  "preflight",
  "lineup_verified",
  "adjustment_verified",
  "manual_completion",
]);

export const subRequestSnapshotSourceEnum = pgEnum("sub_request_snapshot_source", [
  "observed",
  "entered_by_hand",
]);

// One substitution request, refused ones included. Points are integer tenths. `version` goes up
// with every change, so of two writers acting on one version only the first wins.
export const subRequests = pgTable(
  "sub_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    kind: subRequestKindEnum("kind").notNull(),
    teamId: integer("team_id").notNull(),
    season: integer("season").notNull(),
    matchupPeriodId: integer("matchup_period_id").notNull(),
    matchupId: integer("matchup_id").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => userAccounts.userId),
    idempotencyKey: text("idempotency_key").notNull(),
    injuredPlayerId: integer("injured_player_id").notNull(),
    injuredName: text("injured_name").notNull(),
    injuredSlot: text("injured_slot").notNull(),
    replacementPlayerId: integer("replacement_player_id").notNull(),
    replacementName: text("replacement_name").notNull(),
    // The confirm time, or the stated moment of an on-behalf request; filedAt is when it was filed.
    requestMoment: timestamp("request_moment", { withTimezone: true }).notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    // ESPN's day at the request moment, never the clock's date.
    requestDay: integer("request_day").notNull(),
    // ESPN's designations as read (text: ESPN may send one the app doesn't know). The one at
    // filing is set only for an on-behalf request, whose designation at the moment is attested.
    designationAtRequest: text("designation_at_request").notNull(),
    designationAtFiling: text("designation_at_filing"),
    replacementPointsAtRequestTenths: integer("replacement_points_at_request_tenths"),
    snapshotSource: subRequestSnapshotSourceEnum("snapshot_source"),
    attestedFields: text("attested_fields").array().notNull().default(sql`'{}'::text[]`),
    status: subRequestStatusEnum("status").notNull(),
    reviewReason: subRequestReviewReasonEnum("review_reason"),
    // Why a request was refused at Confirm, from domain's list (text, as event types are).
    refusalReason: text("refusal_reason"),
    lineupState: subRequestLineupStateEnum("lineup_state").notNull().default("pending"),
    adjustmentState: subRequestAdjustmentStateEnum("adjustment_state").notNull().default("pending"),
    executionModeAtRequest: leagueExecutionModeEnum("execution_mode_at_request").notNull(),
    // When a waiting request goes to review: set at filing and reset on approval.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    projectedAdjustmentTenths: integer("projected_adjustment_tenths"),
    // The computed amount shown at approval, kept apart from any override.
    approvedComputedTenths: integer("approved_computed_tenths"),
    finalAdjustmentTenths: integer("final_adjustment_tenths"),
    overrideAdjustmentTenths: integer("override_adjustment_tenths"),
    // The first day ESPN showed the replacement active; null until known, or if never this matchup.
    effectiveDay: integer("effective_day"),
    isRehearsal: boolean("is_rehearsal").notNull().default(false),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamIdempotencyUnique: uniqueIndex("sub_requests_team_idempotency_unique").on(
      table.teamId,
      table.idempotencyKey
    ),
    // One live request per injured player per matchup. A refused, rejected or withdrawn one frees
    // him; a proving request never holds him.
    activeInjuredUnique: uniqueIndex("sub_requests_active_injured_unique")
      .on(table.season, table.matchupPeriodId, table.teamId, table.injuredPlayerId)
      .where(
        sql`${table.status} not in ('refused', 'rejected', 'withdrawn') and ${table.kind} <> 'proving'`
      ),
    statusIdx: index("sub_requests_status_idx").on(table.status),
    teamCreatedAtIdx: index("sub_requests_team_id_created_at_idx").on(
      table.teamId,
      table.createdAt
    ),
  })
);

// Append-only: every change to a request and who made it.
export const subRequestEvents = pgTable(
  "sub_request_events",
  {
    eventId: uuid("event_id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => subRequests.requestId),
    actorType: subRequestActorTypeEnum("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => userAccounts.userId),
    // From domain's event list; text, since each pgEnum value would be a migration.
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requestCreatedAtIdx: index("sub_request_events_request_id_created_at_idx").on(
      table.requestId,
      table.createdAt
    ),
  })
);

// ESPN's state as a request saw it at each phase; never changed once written.
export const subRequestSnapshots = pgTable(
  "sub_request_snapshots",
  {
    snapshotId: uuid("snapshot_id").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => subRequests.requestId),
    phase: subRequestSnapshotPhaseEnum("phase").notNull(),
    espnDay: integer("espn_day").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
  },
  (table) => ({
    requestIdIdx: index("sub_request_snapshots_request_id_idx").on(table.requestId),
  })
);

// The league's one settings row. Absent until first saved; reads give the defaults then. An empty
// allowlist means automation is off.
export const leagueSettings = pgTable(
  "league_settings",
  {
    settingsId: integer("settings_id").primaryKey().default(1),
    executionMode: leagueExecutionModeEnum("execution_mode").notNull().default("approval_required"),
    writeAllowlist: integer("write_allowlist").array().notNull().default(sql`'{}'::integer[]`),
    // The team list automation had when the commissioner switched it off; switching it back on
    // restores it (Dec-D31e). Null while automation isn't switched off.
    allowlistBeforeOff: integer("allowlist_before_off").array(),
    provingDoneAt: timestamp("proving_done_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => userAccounts.userId),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    singleRow: check("league_settings_single_row", sql`${table.settingsId} = 1`),
  })
);

// Emails waiting for the worker. The dedupe key (request id and version) is also Resend's
// idempotency key. A claim is committed before sending; each claim counts as an attempt.
export const emailOutbox = pgTable(
  "email_outbox",
  {
    emailId: uuid("email_id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
  },
  (table) => ({
    dedupeKeyUnique: uniqueIndex("email_outbox_dedupe_key_unique").on(table.dedupeKey),
    pendingIdx: index("email_outbox_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.sentAt} is null and ${table.failedAt} is null`),
  })
);
