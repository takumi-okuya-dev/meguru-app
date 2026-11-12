-- Threadsの運営の設定（テスター招待の枠）と、利用者ごとの「最後に開いたアカウント」を、Threads専用の表へ移す
-- （specs/meguru/029-threads-pattern1 tasks.md T024・T071）。表を足して値を写すだけ。共通の古い列は PR5 まで残す（前の版でも壊れない）。
CREATE TABLE "threads_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"tester_slot_capacity" integer DEFAULT 25 NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_settings_singleton" CHECK ("threads_settings"."id" = 1),
	CONSTRAINT "threads_settings_tester_slot_capacity_range" CHECK ("threads_settings"."tester_slot_capacity" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "threads_user_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_account_id" uuid,
	"last_account_deleted_at" timestamp with time zone,
	"last_account_client_id" text,
	"last_account_open_seq" bigint,
	"last_account_open_received_at" timestamp (6) with time zone
);
--> statement-breakpoint
ALTER TABLE "threads_user_states" ADD CONSTRAINT "threads_user_states_last_account_id_accounts_id_fk" FOREIGN KEY ("last_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- 値を写す（何度当てても同じ結果になる）
INSERT INTO "threads_settings" ("id", "tester_slot_capacity")
SELECT 1, "tester_slot_capacity" FROM "operator_settings" WHERE "id" = 1
ON CONFLICT ("id") DO UPDATE SET "tester_slot_capacity" = EXCLUDED."tester_slot_capacity";
--> statement-breakpoint
INSERT INTO "threads_user_states" ("user_id", "last_account_id", "last_account_deleted_at", "last_account_client_id", "last_account_open_seq", "last_account_open_received_at")
SELECT "id", "last_account_id", "last_account_deleted_at", "last_account_client_id", "last_account_open_seq", "last_account_open_received_at"
FROM "users"
-- 退会を受け付けた人は写さない（Threadsの片づけがもう済んでいることがあり、写すと消す人がいなくなる。PR #97 のセルフレビュー）
WHERE "withdrawal_requested_at" IS NULL
  AND ("last_account_id" IS NOT NULL OR "last_account_deleted_at" IS NOT NULL OR "last_account_open_received_at" IS NOT NULL)
ON CONFLICT ("user_id") DO NOTHING;
