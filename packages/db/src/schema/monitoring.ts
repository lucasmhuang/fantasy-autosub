import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { userAccounts } from "./auth";
import { espnAccessStateEnum } from "./execution";
import { subRequests } from "./requests";

// Declared twice (packages/domain monitoring/alerts.ts); apps/worker's enum-pairs test pins it.
export const misuseAlertKindEnum = pgEnum("misuse_alert_kind", [
  "lm_transaction",
  "lm_adjustment",
  "lm_league_change",
  "adjustment_mismatch",
  "league_public",
]);

// One alert per ESPN reference (M4): a check that sees the same action again finds its row. An
// alert stays open until acknowledged: by the commissioner (who and when), or on its own when it
// exactly matches a by-hand completion (the request named, Dec-D31a), or by the first run for an
// action known to be the owner's (a note, Dec-D15).
export const misuseAlerts = pgTable("misuse_alerts", {
  alertId: uuid("alert_id").primaryKey(),
  espnRef: text("espn_ref").notNull().unique(),
  kind: misuseAlertKindEnum("kind").notNull(),
  teamId: integer("team_id"),
  // The team's name as ESPN shows it (Dec-D32a).
  teamName: text("team_name"),
  // ESPN's time for the action; null for a state found by a read (the league turned public).
  espnAt: timestamp("espn_at", { withTimezone: true }),
  // What it was, and what undoing it takes (M10).
  details: jsonb("details").notNull(),
  foundAt: timestamp("found_at", { withTimezone: true }).notNull(),
  // Found by detection's first run: on ESPN before the watch began, listed once (OQ18).
  foundBeforeWatch: boolean("found_before_watch").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => userAccounts.userId),
  matchedRequestId: uuid("matched_request_id").references(() => subRequests.requestId),
  acknowledgedNote: text("acknowledged_note"),
});

// Misuse detection's own state, one row for the league: whether its last check could read ESPN
// (an episode starts when the state changes, so a pause is announced once), whether its first run
// is done, and the last ESPN day it read through, so a worker that was down picks up from there.
export const misuseWatch = pgTable(
  "misuse_watch",
  {
    watchId: integer("watch_id").primaryKey().default(1),
    state: espnAccessStateEnum("state").notNull(),
    code: text("code"),
    since: timestamp("since", { withTimezone: true }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    firstRunAt: timestamp("first_run_at", { withTimezone: true }),
    scannedThroughDay: integer("scanned_through_day"),
    // The commissioner team's moves over the last day, as its last reading pass found them, for
    // the commissioner to skim (D16, M9): its own path on that team raises no alert.
    teamMoves: jsonb("team_moves"),
  },
  (table) => ({
    singleRow: check("misuse_watch_single_row", sql`${table.watchId} = 1`),
  })
);

// Each worker's last beat. The uptime endpoint reads the newest (O8); a worker that hangs stops
// beating while Railway still reports it running.
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  beatAt: timestamp("beat_at", { withTimezone: true }).notNull(),
});
