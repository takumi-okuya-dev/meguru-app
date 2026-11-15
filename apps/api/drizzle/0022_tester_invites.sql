CREATE TABLE "operator_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"subject_user_id" uuid,
	"application_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"default_account_limit" integer DEFAULT 3 NOT NULL,
	"default_daily_post_limit" integer DEFAULT 10 NOT NULL,
	"tester_slot_capacity" integer DEFAULT 25 NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_settings_singleton" CHECK ("operator_settings"."id" = 1),
	CONSTRAINT "operator_settings_account_limit_range" CHECK ("operator_settings"."default_account_limit" BETWEEN 1 AND 1000),
	CONSTRAINT "operator_settings_daily_post_limit_range" CHECK ("operator_settings"."default_daily_post_limit" BETWEEN 1 AND 250),
	CONSTRAINT "operator_settings_slot_capacity_range" CHECK ("operator_settings"."tester_slot_capacity" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "tester_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"account_id" uuid,
	"threads_username" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"holds_slot" boolean DEFAULT false NOT NULL,
	"removal_reason" text,
	"decline_reason" text,
	"connected_username" text,
	"status_changed_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tester_applications_username_valid" CHECK ("tester_applications"."threads_username" ~ '^[a-z0-9._]{1,30}$'),
	CONSTRAINT "tester_applications_status_valid" CHECK ("tester_applications"."status" IN ('pending', 'invited', 'connected', 'declined', 'withdrawn')),
	CONSTRAINT "tester_applications_removal_reason_valid" CHECK ("tester_applications"."removal_reason" IS NULL OR ("tester_applications"."removal_reason" IN ('account_deleted', 'user_withdrawn', 'withdrawn', 'token_connected', 'username_mismatch') AND "tester_applications"."status" = 'withdrawn')),
	CONSTRAINT "tester_applications_decline_reason_length" CHECK ("tester_applications"."decline_reason" IS NULL OR char_length("tester_applications"."decline_reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "posting_schedules" DROP CONSTRAINT "posting_schedules_slot_count";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_limit" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_post_limit" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legacy_trial" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_events" ADD CONSTRAINT "operator_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_events" ADD CONSTRAINT "operator_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_events" ADD CONSTRAINT "operator_events_application_id_tester_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tester_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tester_applications" ADD CONSTRAINT "tester_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tester_applications" ADD CONSTRAINT "tester_applications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_events_actor_action_idx" ON "operator_events" USING btree ("actor_user_id","action","created_at");--> statement-breakpoint
CREATE INDEX "operator_events_created_idx" ON "operator_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tester_applications_live_account_uq" ON "tester_applications" USING btree ("account_id") WHERE "tester_applications"."status" IN ('pending', 'invited', 'connected');--> statement-breakpoint
CREATE INDEX "tester_applications_status_idx" ON "tester_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tester_applications_username_idx" ON "tester_applications" USING btree ("threads_username");--> statement-breakpoint
CREATE INDEX "tester_applications_slot_idx" ON "tester_applications" USING btree ("holds_slot") WHERE "tester_applications"."holds_slot";--> statement-breakpoint
CREATE INDEX "tester_applications_user_idx" ON "tester_applications" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "posting_schedules" ADD CONSTRAINT "posting_schedules_slot_count" CHECK (cardinality("posting_schedules"."slot_minutes") <= 250);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_limit_range" CHECK ("users"."account_limit" IS NULL OR "users"."account_limit" BETWEEN 1 AND 1000);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_daily_post_limit_range" CHECK ("users"."daily_post_limit" IS NULL OR "users"."daily_post_limit" BETWEEN 1 AND 250);--> statement-breakpoint
INSERT INTO "operator_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;