ALTER TABLE "sessions" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "template" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "template_data" jsonb;--> statement-breakpoint
ALTER TABLE "league_settings" ADD COLUMN "season_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "league_settings" ADD COLUMN "season_final" jsonb;--> statement-breakpoint
ALTER TABLE "league_settings" ADD COLUMN "practice_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_request_id_sub_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sub_requests"("request_id") ON DELETE no action ON UPDATE no action;