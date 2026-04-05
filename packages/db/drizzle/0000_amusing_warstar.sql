CREATE TYPE "public"."login_link_status" AS ENUM('active', 'used', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('manager', 'commissioner');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('auto_execute', 'approval_required');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('queued', 'executing', 'pending_review', 'stale_requires_review', 'fallback_required', 'rejected', 'executed', 'failed', 'reversed');--> statement-breakpoint
CREATE TABLE "login_link_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_path" text,
	"status" "login_link_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"team_id" integer,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "user_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "substitution_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "substitution_requests" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"matchup_period_id" integer NOT NULL,
	"execution_mode" "execution_mode" NOT NULL,
	"status" "request_status" NOT NULL,
	"injured_player_id" integer NOT NULL,
	"replacement_player_id" integer NOT NULL,
	"preview_adjustment" numeric(8, 1) NOT NULL,
	"lineup_resolution" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_execution_leases" (
	"lease_key" text PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"matchup_period_id" integer NOT NULL,
	"holder_request_id" uuid NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_link_tokens" ADD CONSTRAINT "login_link_tokens_user_id_user_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_user_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitution_events" ADD CONSTRAINT "substitution_events_request_id_substitution_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."substitution_requests"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_execution_leases" ADD CONSTRAINT "team_execution_leases_holder_request_id_substitution_requests_request_id_fk" FOREIGN KEY ("holder_request_id") REFERENCES "public"."substitution_requests"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_link_tokens_user_id_idx" ON "login_link_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_link_tokens_status_idx" ON "login_link_tokens" USING btree ("status");--> statement-breakpoint
CREATE INDEX "login_link_tokens_expires_at_idx" ON "login_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_revoked_at_idx" ON "sessions" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "user_accounts_team_id_idx" ON "user_accounts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "user_accounts_role_idx" ON "user_accounts" USING btree ("role");--> statement-breakpoint
CREATE INDEX "substitution_events_request_id_idx" ON "substitution_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "substitution_events_created_at_idx" ON "substitution_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "substitution_requests_team_week_idx" ON "substitution_requests" USING btree ("team_id","matchup_period_id");--> statement-breakpoint
CREATE INDEX "substitution_requests_status_idx" ON "substitution_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "substitution_requests_created_at_idx" ON "substitution_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "team_execution_leases_team_week_idx" ON "team_execution_leases" USING btree ("team_id","matchup_period_id");--> statement-breakpoint
CREATE INDEX "team_execution_leases_expires_at_idx" ON "team_execution_leases" USING btree ("expires_at");