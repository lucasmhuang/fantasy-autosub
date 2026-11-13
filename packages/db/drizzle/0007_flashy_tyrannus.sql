CREATE TYPE "public"."espn_access_state" AS ENUM('working', 'credentials_rejected', 'unreachable');--> statement-breakpoint
CREATE TABLE "espn_access" (
	"access_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"state" "espn_access_state" NOT NULL,
	"code" text,
	"since" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "espn_access_single_row" CHECK ("espn_access"."access_id" = 1)
);
