ALTER TYPE "public"."espn_access_state" ADD VALUE 'not_connected';--> statement-breakpoint
CREATE TABLE "league_rules_check" (
	"check_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mismatches" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"last_matched_at" timestamp with time zone,
	CONSTRAINT "league_rules_check_single_row" CHECK ("league_rules_check"."check_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"team_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "misuse_alerts" ADD COLUMN "players" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "league_settings" ADD COLUMN "automation_changed_at" timestamp with time zone;