CREATE TYPE "public"."league_execution_mode" AS ENUM('approval_required', 'auto');--> statement-breakpoint
CREATE TYPE "public"."sub_request_actor_type" AS ENUM('manager', 'commissioner', 'system');--> statement-breakpoint
CREATE TYPE "public"."sub_request_adjustment_state" AS ENUM('not_owed', 'pending', 'held', 'sent', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sub_request_kind" AS ENUM('substitution', 'on_behalf', 'proving');--> statement-breakpoint
CREATE TYPE "public"."sub_request_lineup_state" AS ENUM('pending', 'sent', 'verified', 'ambiguous', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sub_request_review_reason" AS ENUM('automation_off', 'not_allowlisted', 'rearrangement', 'suspension', 'stale', 'ambiguous', 'lineup_failed', 'adjustment_failed', 'adjustment_held_rules', 'adjustment_changed', 'expired', 'week_ended', 'playoffs');--> statement-breakpoint
CREATE TYPE "public"."sub_request_snapshot_phase" AS ENUM('request', 'preflight', 'lineup_verified', 'adjustment_verified', 'manual_completion');--> statement-breakpoint
CREATE TYPE "public"."sub_request_snapshot_source" AS ENUM('observed', 'entered_by_hand');--> statement-breakpoint
CREATE TYPE "public"."sub_request_status" AS ENUM('refused', 'awaiting_approval', 'queued', 'executing', 'needs_review', 'completed', 'completed_manually', 'rejected', 'withdrawn', 'reversed');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"email_id" uuid PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"settings_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"execution_mode" "league_execution_mode" DEFAULT 'approval_required' NOT NULL,
	"write_allowlist" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"proving_done_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_settings_single_row" CHECK ("league_settings"."settings_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "sub_request_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_type" "sub_request_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_request_snapshots" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"phase" "sub_request_snapshot_phase" NOT NULL,
	"espn_day" integer NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"kind" "sub_request_kind" NOT NULL,
	"team_id" integer NOT NULL,
	"season" integer NOT NULL,
	"matchup_period_id" integer NOT NULL,
	"matchup_id" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"injured_player_id" integer NOT NULL,
	"injured_name" text NOT NULL,
	"injured_slot" text NOT NULL,
	"replacement_player_id" integer NOT NULL,
	"replacement_name" text NOT NULL,
	"request_moment" timestamp with time zone NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"request_day" integer NOT NULL,
	"designation_at_request" text NOT NULL,
	"designation_at_filing" text,
	"replacement_points_at_request_tenths" integer,
	"snapshot_source" "sub_request_snapshot_source",
	"attested_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "sub_request_status" NOT NULL,
	"review_reason" "sub_request_review_reason",
	"refusal_reason" text,
	"lineup_state" "sub_request_lineup_state" DEFAULT 'pending' NOT NULL,
	"adjustment_state" "sub_request_adjustment_state" DEFAULT 'pending' NOT NULL,
	"execution_mode_at_request" "league_execution_mode" NOT NULL,
	"expires_at" timestamp with time zone,
	"projected_adjustment_tenths" integer,
	"approved_computed_tenths" integer,
	"final_adjustment_tenths" integer,
	"override_adjustment_tenths" integer,
	"effective_day" integer,
	"is_rehearsal" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_updated_by_user_accounts_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_request_events" ADD CONSTRAINT "sub_request_events_request_id_sub_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sub_requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_request_events" ADD CONSTRAINT "sub_request_events_actor_user_id_user_accounts_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_request_snapshots" ADD CONSTRAINT "sub_request_snapshots_request_id_sub_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sub_requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_requests" ADD CONSTRAINT "sub_requests_requested_by_user_accounts_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_key_unique" ON "email_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_outbox_pending_idx" ON "email_outbox" USING btree ("created_at") WHERE "email_outbox"."sent_at" is null and "email_outbox"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "sub_request_events_request_id_created_at_idx" ON "sub_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "sub_request_snapshots_request_id_idx" ON "sub_request_snapshots" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_requests_team_idempotency_unique" ON "sub_requests" USING btree ("team_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_requests_active_injured_unique" ON "sub_requests" USING btree ("season","matchup_period_id","team_id","injured_player_id") WHERE "sub_requests"."status" not in ('refused', 'rejected', 'withdrawn') and "sub_requests"."kind" <> 'proving';--> statement-breakpoint
CREATE INDEX "sub_requests_status_idx" ON "sub_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sub_requests_team_id_created_at_idx" ON "sub_requests" USING btree ("team_id","created_at");