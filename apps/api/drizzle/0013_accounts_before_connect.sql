ALTER TYPE "public"."connection_status" ADD VALUE 'not_connected';--> statement-breakpoint
ALTER TYPE "public"."oauth_mode" ADD VALUE 'connect';--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "threads_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "connection_method" DROP NOT NULL;--> statement-breakpoint
-- specs/012-accounts-before-connect data-model.md：今のアカウントの名前は、Threadsの表示名（空・空白だけならユーザー名）の先頭50文字で埋める。
-- 列挙型の値の追加は別の文にしてあり、この中では新しい値を使わない（CHECK は ::text で比べる）。
ALTER TABLE "accounts" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "accounts" SET "name" = btrim(left(btrim(COALESCE(NULLIF(btrim("display_name"), ''), "username")), 50));--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_length" CHECK (char_length("accounts"."name") BETWEEN 1 AND 50 AND "accounts"."name" = btrim("accounts"."name"));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_consistency" CHECK (("accounts"."connection_status"::text = 'not_connected' AND "accounts"."threads_user_id" IS NULL AND "accounts"."username" IS NULL AND "accounts"."connection_method" IS NULL)
      OR ("accounts"."connection_status"::text <> 'not_connected' AND "accounts"."threads_user_id" IS NOT NULL AND "accounts"."username" IS NOT NULL AND "accounts"."connection_method" IS NOT NULL));