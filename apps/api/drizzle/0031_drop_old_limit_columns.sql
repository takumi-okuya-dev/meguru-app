-- 029 の PR5：上限の古い列と、Threadsの「最後に開いたアカウント」の古い列、operator_settings を消す
-- （specs/meguru/029-threads-pattern1 data-model.md 1-1・5、tasks.md T060）。値は PR1 から新しい表（app_limit_defaults・user_app_limits）
-- と threads.settings・threads.user_states にも書いてきた。念のため、新しい表にない値だけを写してから消す（新しい表の値は上書きしない）。
INSERT INTO "app_limit_defaults" ("app", "key", "value")
SELECT 'threads', 'accounts', "default_account_limit" FROM "operator_settings" WHERE "id" = 1
UNION ALL SELECT 'threads', 'daily_posts', "default_daily_post_limit" FROM "operator_settings" WHERE "id" = 1
ON CONFLICT ("app", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_app_limits" ("user_id", "app", "key", "value")
SELECT "id", 'threads', 'accounts', "account_limit" FROM "users" WHERE "account_limit" IS NOT NULL
UNION ALL SELECT "id", 'threads', 'daily_posts', "daily_post_limit" FROM "users" WHERE "daily_post_limit" IS NOT NULL
ON CONFLICT ("user_id", "app", "key") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "operator_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "operator_settings" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_account_limit_range";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_daily_post_limit_range";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_account_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_account_deleted_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_account_client_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_account_open_seq";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_account_open_received_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_limit";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "daily_post_limit";