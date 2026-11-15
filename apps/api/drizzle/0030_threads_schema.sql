-- 029 の PR3：Threadsの表をスキーマ threads へ移し、共通 ⇄ Threads の外部キーを外す（specs/meguru/029-threads-pattern1 research.md R2・R3、tasks.md T041）。
-- 移すのは ALTER TABLE … SET SCHEMA だけ（DROP TABLE・CREATE TABLE はしない）。中身・索引・制約・Threadsの中の外部キーはそのまま残る。
CREATE SCHEMA IF NOT EXISTS "threads";
--> statement-breakpoint
-- 外部キーを外す前に、退会の途中の人（Threadsの片づけは済み、users の行はまだ）の残りを片づける。以前は users の行を消したときに
-- 外部キーの cascade・set null がしていたこと（research.md R3）。片づけがまだの人は、新しい退会の片づけ（withdrawal-cleanup.ts）が行う（PR #99 のセルフレビュー）。
DELETE FROM "public"."memberships" WHERE user_id IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
DELETE FROM "public"."team_members" WHERE user_id IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
DELETE FROM "public"."token_check_failures" WHERE user_id IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
DELETE FROM "public"."oauth_states" WHERE user_id IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
DELETE FROM "public"."threads_user_states" WHERE user_id IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."accounts" SET "core_rules_updated_by_user_id" = NULL WHERE "core_rules_updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."accounts" SET "promotion_ratio_updated_by_user_id" = NULL WHERE "promotion_ratio_updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."accounts" SET "prompt_post_count_updated_by_user_id" = NULL WHERE "prompt_post_count_updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."team_accounts" SET "added_by_user_id" = NULL WHERE "added_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."activity_logs" SET "actor_user_id" = NULL WHERE "actor_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."tester_applications" SET "user_id" = NULL WHERE "user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."strategy_designs" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."promotions" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."reference_posts" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."research_keywords" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."post_drafts" SET "created_by_user_id" = NULL WHERE "created_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."post_drafts" SET "edited_by_user_id" = NULL WHERE "edited_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."posting_schedules" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."post_metrics" SET "feedback_updated_by_user_id" = NULL WHERE "feedback_updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."promotion_listings" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."media_defaults" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."analysis_settings" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."post_classifications" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."mention_settings" SET "updated_by_user_id" = NULL WHERE "updated_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
UPDATE "public"."post_mentions" SET "created_by_user_id" = NULL WHERE "created_by_user_id" IN (SELECT u.id FROM "public"."users" u WHERE u.withdrawal_requested_at IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."platform_events" e JOIN "public"."threads_received_events" r ON r.event_id = e.id WHERE e.type = 'user.withdrawn' AND e.payload->>'userId' = u.id::text));
--> statement-breakpoint
ALTER TABLE "public"."accounts" DROP CONSTRAINT "accounts_core_rules_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."accounts" DROP CONSTRAINT "accounts_promotion_ratio_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."accounts" DROP CONSTRAINT "accounts_prompt_post_count_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."activity_logs" DROP CONSTRAINT "activity_logs_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."analysis_settings" DROP CONSTRAINT "analysis_settings_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."media_defaults" DROP CONSTRAINT "media_defaults_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."memberships" DROP CONSTRAINT "memberships_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."mention_settings" DROP CONSTRAINT "mention_settings_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."oauth_states" DROP CONSTRAINT "oauth_states_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."operator_events" DROP CONSTRAINT "operator_events_application_id_tester_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."post_classifications" DROP CONSTRAINT "post_classifications_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."post_drafts" DROP CONSTRAINT "post_drafts_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."post_drafts" DROP CONSTRAINT "post_drafts_edited_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."post_mentions" DROP CONSTRAINT "post_mentions_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."post_metrics" DROP CONSTRAINT "post_metrics_feedback_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."posting_schedules" DROP CONSTRAINT "posting_schedules_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."promotion_listings" DROP CONSTRAINT "promotion_listings_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."promotions" DROP CONSTRAINT "promotions_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."reference_posts" DROP CONSTRAINT "reference_posts_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."research_keywords" DROP CONSTRAINT "research_keywords_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."strategy_designs" DROP CONSTRAINT "strategy_designs_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."team_accounts" DROP CONSTRAINT "team_accounts_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."team_members" DROP CONSTRAINT "team_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."teams" DROP CONSTRAINT "teams_admin_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."tester_applications" DROP CONSTRAINT "tester_applications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."token_check_failures" DROP CONSTRAINT "token_check_failures_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."users" DROP CONSTRAINT "users_last_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."accounts" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."memberships" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."teams" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."team_members" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."team_accounts" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."activity_logs" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."threads_connections" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."token_check_failures" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."oauth_states" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."threads_deletion_requests" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."threads_revocations" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."strategy_designs" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."promotions" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."reference_posts" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."research_keywords" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."draft_batches" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."post_drafts" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."posting_schedules" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."publish_attempts" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."ng_words" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."post_metrics" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."post_metric_snapshots" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."follower_snapshots" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."tester_applications" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."promotion_listings" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."media_defaults" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."analysis_settings" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."post_classifications" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."mention_settings" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."mention_people" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."post_mentions" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "public"."threads_received_events" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "threads"."threads_received_events" RENAME TO "received_events";
--> statement-breakpoint
ALTER TABLE "public"."threads_user_states" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "threads"."threads_user_states" RENAME TO "user_states";
--> statement-breakpoint
ALTER TABLE "public"."threads_settings" SET SCHEMA "threads";
--> statement-breakpoint
ALTER TABLE "threads"."threads_settings" RENAME TO "settings";
--> statement-breakpoint
-- 名前を変えた表の外部キーの名前を、drizzle の決まりの名前にそろえる
ALTER TABLE "threads"."user_states" RENAME CONSTRAINT "threads_user_states_last_account_id_accounts_id_fk" TO "user_states_last_account_id_accounts_id_fk";
