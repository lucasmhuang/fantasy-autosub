-- Added by hand: the scaffold's tables have never been read or written since 0000, but the hosted
-- ones were never inspected. A row in any of them stops the migration (and with it the deploy)
-- before anything is dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "substitution_events")
    OR EXISTS (SELECT 1 FROM "substitution_requests")
    OR EXISTS (SELECT 1 FROM "team_execution_leases") THEN
    RAISE EXCEPTION 'migration 0006 drops the unused scaffold tables, and one holds a row: inspect it before deploying';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "substitution_events" CASCADE;--> statement-breakpoint
DROP TABLE "substitution_requests" CASCADE;--> statement-breakpoint
DROP TABLE "team_execution_leases" CASCADE;--> statement-breakpoint
DROP TYPE "public"."execution_mode";--> statement-breakpoint
DROP TYPE "public"."request_status";