CREATE TABLE "app_limit_defaults" (
	"app" text NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "app_limit_defaults_pkey" PRIMARY KEY("app","key"),
	CONSTRAINT "app_limit_defaults_value_range" CHECK ("app_limit_defaults"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_usage" (
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"in_use" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_usage_pkey" PRIMARY KEY("user_id","app"),
	CONSTRAINT "app_usage_quantity_range" CHECK ("app_usage"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_event_deliveries" (
	"event_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp (6) with time zone,
	CONSTRAINT "platform_event_deliveries_pkey" PRIMARY KEY("event_id","consumer"),
	CONSTRAINT "platform_event_deliveries_status_valid" CHECK ("platform_event_deliveries"."status" IN ('pending', 'done', 'failed')),
	CONSTRAINT "platform_event_deliveries_attempts_range" CHECK ("platform_event_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_events_type_valid" CHECK ("platform_events"."type" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$')
);
--> statement-breakpoint
CREATE TABLE "user_app_limits" (
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "user_app_limits_pkey" PRIMARY KEY("user_id","app","key"),
	CONSTRAINT "user_app_limits_value_range" CHECK ("user_app_limits"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "feature_disables" DROP CONSTRAINT "feature_disables_feature_valid";--> statement-breakpoint
ALTER TABLE "feature_setting_events" DROP CONSTRAINT "feature_setting_events_feature_valid";--> statement-breakpoint
ALTER TABLE "group_feature_disables" DROP CONSTRAINT "group_feature_disables_feature_valid";--> statement-breakpoint
ALTER TABLE "feature_disables" ADD COLUMN "app" text DEFAULT 'threads' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_setting_events" ADD COLUMN "app" text DEFAULT 'threads' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_feature_disables" ADD COLUMN "app" text DEFAULT 'threads' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_event_deliveries" ADD CONSTRAINT "platform_event_deliveries_event_id_platform_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."platform_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_limits" ADD CONSTRAINT "user_app_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_event_deliveries_due_idx" ON "platform_event_deliveries" USING btree ("next_attempt_at") WHERE "platform_event_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "platform_events_created_idx" ON "platform_events" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "feature_disables" DROP CONSTRAINT "feature_disables_pkey";
--> statement-breakpoint
ALTER TABLE "feature_disables" ADD CONSTRAINT "feature_disables_pkey" PRIMARY KEY("user_id","app","feature");--> statement-breakpoint
ALTER TABLE "group_feature_disables" DROP CONSTRAINT "group_feature_disables_pkey";
--> statement-breakpoint
ALTER TABLE "group_feature_disables" ADD CONSTRAINT "group_feature_disables_pkey" PRIMARY KEY("group_id","app","feature");--> statement-breakpoint
ALTER TABLE "feature_disables" ADD CONSTRAINT "feature_disables_app_valid" CHECK ("feature_disables"."app" ~ '^[a-z][a-z0-9-]{0,30}$');--> statement-breakpoint
ALTER TABLE "feature_disables" ADD CONSTRAINT "feature_disables_feature_valid" CHECK ("feature_disables"."feature" ~ '^[a-z_]{1,30}$');--> statement-breakpoint
ALTER TABLE "feature_setting_events" ADD CONSTRAINT "feature_setting_events_app_valid" CHECK ("feature_setting_events"."app" ~ '^[a-z][a-z0-9-]{0,30}$');--> statement-breakpoint
ALTER TABLE "feature_setting_events" ADD CONSTRAINT "feature_setting_events_feature_valid" CHECK ("feature_setting_events"."feature" ~ '^[a-z_]{1,30}$');--> statement-breakpoint
ALTER TABLE "group_feature_disables" ADD CONSTRAINT "group_feature_disables_app_valid" CHECK ("group_feature_disables"."app" ~ '^[a-z][a-z0-9-]{0,30}$');--> statement-breakpoint
ALTER TABLE "group_feature_disables" ADD CONSTRAINT "group_feature_disables_feature_valid" CHECK ("group_feature_disables"."feature" ~ '^[a-z_]{1,30}$');--> statement-breakpoint
-- 今のデータを写す（specs/meguru/029-threads-pattern1 data-model.md 2・5）。
-- 利用の数：持ち主としてのアカウントの数。使っているか：アカウントのメンバーか、チームに入っているか
-- （機能のOFFの細かい判定は含めない。PR2 で Threads が数え直し、/api/threads/me と毎日の処理でも直す）
INSERT INTO "app_usage" ("user_id", "app", "quantity", "in_use", "updated_at")
SELECT u."id", 'threads',
  (SELECT count(*)::int FROM "memberships" m WHERE m."user_id" = u."id" AND m."role" = 'owner'),
  EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = u."id")
    OR EXISTS (SELECT 1 FROM "team_members" tm WHERE tm."user_id" = u."id"),
  now()
FROM "users" u
ON CONFLICT ("user_id", "app") DO NOTHING;
--> statement-breakpoint
-- 上限：利用者ごとの値（ある人だけ）と、既定の値
INSERT INTO "user_app_limits" ("user_id", "app", "key", "value")
SELECT "id", 'threads', 'accounts', "account_limit" FROM "users" WHERE "account_limit" IS NOT NULL
UNION ALL
SELECT "id", 'threads', 'daily_posts', "daily_post_limit" FROM "users" WHERE "daily_post_limit" IS NOT NULL
ON CONFLICT ("user_id", "app", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "app_limit_defaults" ("app", "key", "value")
SELECT 'threads', 'accounts', "default_account_limit" FROM "operator_settings" WHERE "id" = 1
UNION ALL
SELECT 'threads', 'daily_posts', "default_daily_post_limit" FROM "operator_settings" WHERE "id" = 1
ON CONFLICT ("app", "key") DO NOTHING;
