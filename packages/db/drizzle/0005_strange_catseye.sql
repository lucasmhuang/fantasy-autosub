CREATE TYPE "public"."espn_write_kind" AS ENUM('lineup', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."espn_write_outcome" AS ENUM('verified', 'not_applied', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."espn_write_status" AS ENUM('sending', 'answered', 'failed', 'recorded_only');--> statement-breakpoint
CREATE TABLE "espn_write_lock" (
	"lock_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"holder" text NOT NULL,
	"token" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "espn_write_lock_single_row" CHECK ("espn_write_lock"."lock_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "espn_writes" (
	"write_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "espn_write_kind" NOT NULL,
	"team_id" integer NOT NULL,
	"matchup_id" integer,
	"scoring_period_id" integer,
	"body" jsonb NOT NULL,
	"fencing_token" integer NOT NULL,
	"status" "espn_write_status" DEFAULT 'sending' NOT NULL,
	"failure_code" text,
	"outcome" "espn_write_outcome",
	"readback" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"read_back_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "espn_writes" ADD CONSTRAINT "espn_writes_request_id_sub_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sub_requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "espn_writes_request_id_idx" ON "espn_writes" USING btree ("request_id");