ALTER TYPE "public"."connection_status" ADD VALUE IF NOT EXISTS 'not_connected';--> statement-breakpoint
ALTER TYPE "public"."oauth_mode" ADD VALUE IF NOT EXISTS 'connect';--> statement-breakpoint
ALTER TABLE "oauth_states" DROP CONSTRAINT "oauth_states_target_required_for_reconnect";--> statement-breakpoint
ALTER TABLE "oauth_states" DROP CONSTRAINT "oauth_states_target_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "threads_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "connection_method" DROP NOT NULL;--> statement-breakpoint
-- specs/012-accounts-before-connect data-model.md：今のアカウントの名前は、Threadsの表示名（空・空白だけならユーザー名）の先頭50文字で埋める。
-- 空白は API（JavaScript の trim()）と同じもの（タブ・改行・NBSP・全角スペースなど）で数える（PR #15 のCodexレビュー）。
-- 列挙型の値の追加は別の文にしてあり、この中では新しい値を使わない（CHECK は ::text で比べる）。
ALTER TABLE "accounts" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "accounts" SET "name" = regexp_replace(left(COALESCE(NULLIF(regexp_replace("display_name", '^[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), ''), "username"), 50), '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '');--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_length" CHECK (char_length("accounts"."name") BETWEEN 1 AND 50 AND "accounts"."name" !~ '^[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' AND "accounts"."name" !~ '[\t\n\u000b\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$');--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_consistency" CHECK (("accounts"."connection_status"::text = 'not_connected' AND "accounts"."threads_user_id" IS NULL AND "accounts"."username" IS NULL AND "accounts"."connection_method" IS NULL)
      OR ("accounts"."connection_status"::text <> 'not_connected' AND "accounts"."threads_user_id" IS NOT NULL AND "accounts"."username" IS NOT NULL AND "accounts"."connection_method" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_no_target_for_new" CHECK ("oauth_states"."mode"::text <> 'new' OR "oauth_states"."target_account_id" IS NULL);