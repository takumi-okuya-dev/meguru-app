CREATE TYPE "public"."connection_method" AS ENUM('app', 'token');--> statement-breakpoint
CREATE TABLE "token_check_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "connection_method" "connection_method" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "reconnect_hint" text;--> statement-breakpoint
ALTER TABLE "threads_connections" ADD COLUMN "recheck_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "token_check_failures" ADD CONSTRAINT "token_check_failures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_check_failures_user_time_idx" ON "token_check_failures" USING btree ("user_id","failed_at");--> statement-breakpoint
CREATE INDEX "accounts_username_lower_idx" ON "accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "threads_connections_recheck_idx" ON "threads_connections" USING btree ("recheck_at") WHERE "threads_connections"."recheck_at" IS NOT NULL;