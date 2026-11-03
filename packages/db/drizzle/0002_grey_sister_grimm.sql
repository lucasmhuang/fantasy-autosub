CREATE TABLE "sign_in_codes" (
	"code_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"send_failed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_user_id_user_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_in_codes_user_id_created_at_idx" ON "sign_in_codes" USING btree ("user_id","created_at");