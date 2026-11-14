CREATE TYPE "public"."misuse_alert_kind" AS ENUM('lm_transaction', 'lm_adjustment', 'lm_league_change', 'adjustment_mismatch', 'league_public');--> statement-breakpoint
CREATE TABLE "misuse_alerts" (
	"alert_id" uuid PRIMARY KEY NOT NULL,
	"espn_ref" text NOT NULL,
	"kind" "misuse_alert_kind" NOT NULL,
	"team_id" integer,
	"team_name" text,
	"espn_at" timestamp with time zone,
	"details" jsonb NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	"found_before_watch" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"matched_request_id" uuid,
	"acknowledged_note" text,
	CONSTRAINT "misuse_alerts_espn_ref_unique" UNIQUE("espn_ref")
);
--> statement-breakpoint
CREATE TABLE "misuse_watch" (
	"watch_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"state" "espn_access_state" NOT NULL,
	"code" text,
	"since" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"first_run_at" timestamp with time zone,
	"scanned_through_day" integer,
	CONSTRAINT "misuse_watch_single_row" CHECK ("misuse_watch"."watch_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"beat_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_settings" ADD COLUMN "allowlist_before_off" integer[];--> statement-breakpoint
ALTER TABLE "misuse_alerts" ADD CONSTRAINT "misuse_alerts_acknowledged_by_user_accounts_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misuse_alerts" ADD CONSTRAINT "misuse_alerts_matched_request_id_sub_requests_request_id_fk" FOREIGN KEY ("matched_request_id") REFERENCES "public"."sub_requests"("request_id") ON DELETE no action ON UPDATE no action;