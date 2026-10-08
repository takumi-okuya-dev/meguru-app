-- 006 パフォーマンス分析と改善フィードバック（specs/006-performance-feedback data-model.md「マイグレーション」）
CREATE TYPE "public"."judgment" AS ENUM('good', 'normal', 'poor');--> statement-breakpoint
CREATE TYPE "public"."metrics_kind" AS ENUM('h24', 'd3', 'd7', 'late');--> statement-breakpoint
CREATE TYPE "public"."metrics_state" AS ENUM('updating', 'confirmed', 'late_confirmed', 'unmeasurable');--> statement-breakpoint
CREATE TABLE "follower_snapshots" (
	"account_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"followers_count" integer NOT NULL,
	"captured_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "follower_snapshots_account_id_snapshot_date_pk" PRIMARY KEY("account_id","snapshot_date"),
	CONSTRAINT "follower_snapshots_count_nonnegative" CHECK ("follower_snapshots"."followers_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "post_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "metrics_kind" NOT NULL,
	"method" text NOT NULL,
	"fetched_at" timestamp (6) with time zone NOT NULL,
	"elapsed_minutes" integer NOT NULL,
	"views" integer,
	"likes" integer,
	"replies" integer,
	"reposts" integer,
	"quotes" integer,
	"shares" integer,
	CONSTRAINT "post_metric_snapshots_method_valid" CHECK ("post_metric_snapshots"."method" IN ('slot', 'daily'))
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"state" "metrics_state" NOT NULL,
	"views" integer,
	"likes" integer,
	"replies" integer,
	"reposts" integer,
	"quotes" integer,
	"shares" integer,
	"last_fetched_at" timestamp (6) with time zone,
	"last_elapsed_minutes" integer,
	"last_kind" "metrics_kind",
	"confirmed_at" timestamp (6) with time zone,
	"unmeasurable_reason" text,
	"judgment" "judgment",
	"judgment_ratio" double precision,
	"judgment_baseline" double precision,
	"judged_at" timestamp (6) with time zone,
	"feedback_memo" text,
	"include_in_prompt" boolean DEFAULT true NOT NULL,
	"feedback_updated_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_metrics_unmeasurable_reason" CHECK (("post_metrics"."state"::text = 'unmeasurable') = ("post_metrics"."unmeasurable_reason" IS NOT NULL)),
	CONSTRAINT "post_metrics_unmeasurable_reason_valid" CHECK ("post_metrics"."unmeasurable_reason" IS NULL OR "post_metrics"."unmeasurable_reason" IN ('no_media_id', 'not_found')),
	CONSTRAINT "post_metrics_confirmed_at" CHECK (("post_metrics"."state"::text IN ('confirmed', 'late_confirmed')) = ("post_metrics"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "post_metrics_judgment" CHECK ("post_metrics"."judgment" IS NULL OR ("post_metrics"."state"::text IN ('confirmed', 'late_confirmed') AND "post_metrics"."judgment_ratio" IS NOT NULL AND "post_metrics"."judgment_baseline" > 0)),
	CONSTRAINT "post_metrics_feedback_memo_length" CHECK (char_length("post_metrics"."feedback_memo") <= 200),
	CONSTRAINT "post_metrics_counts_nonnegative" CHECK (coalesce("post_metrics"."views", 0) >= 0 AND coalesce("post_metrics"."likes", 0) >= 0 AND coalesce("post_metrics"."replies", 0) >= 0
        AND coalesce("post_metrics"."reposts", 0) >= 0 AND coalesce("post_metrics"."quotes", 0) >= 0 AND coalesce("post_metrics"."shares", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "promotions_changed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "research_changed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "core_rules_changed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "insights_denied_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "draft_batches" ADD COLUMN "strategy_updated_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "draft_batches" ADD COLUMN "promotions_changed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "draft_batches" ADD COLUMN "research_changed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "draft_batches" ADD COLUMN "core_rules_changed_at" timestamp (6) with time zone;--> statement-breakpoint
-- 既存の下書きは「本文を直したか」が分からないので false（不明）にし、その後の行の既定を true にする（data-model.md）
ALTER TABLE "post_drafts" ADD COLUMN "body_edit_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ALTER COLUMN "body_edit_tracked" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "body_edited_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "published_slot_minute" smallint;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "published_carryover" boolean;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "published_prioritized" boolean;--> statement-breakpoint
ALTER TABLE "follower_snapshots" ADD CONSTRAINT "follower_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metric_snapshots" ADD CONSTRAINT "post_metric_snapshots_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metric_snapshots" ADD CONSTRAINT "post_metric_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_metric_snapshots_draft_kind_unique" ON "post_metric_snapshots" USING btree ("draft_id","kind");--> statement-breakpoint
CREATE INDEX "post_metric_snapshots_account_fetched_idx" ON "post_metric_snapshots" USING btree ("account_id","fetched_at");--> statement-breakpoint
CREATE INDEX "post_metrics_account_state_idx" ON "post_metrics" USING btree ("account_id","state");--> statement-breakpoint
CREATE INDEX "post_metrics_account_poor_idx" ON "post_metrics" USING btree ("account_id","judgment") WHERE "post_metrics"."judgment" = 'poor';--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_published_slot_minute_range" CHECK ("post_drafts"."published_slot_minute" IS NULL OR "post_drafts"."published_slot_minute" BETWEEN 0 AND 1439);--> statement-breakpoint
-- プロンプトの材料を最後に変えた日時を、既存の行の更新日時で埋める（research.md R9）。投稿ルールは保存日時の記録がないので NULL のまま
UPDATE "accounts" a SET "promotions_changed_at" = p.at
  FROM (SELECT "account_id", max("updated_at") AS at FROM "promotions" GROUP BY "account_id") p
  WHERE p."account_id" = a."id";--> statement-breakpoint
UPDATE "accounts" a SET "research_changed_at" = r.at
  FROM (
    SELECT "account_id", max(at) AS at FROM (
      SELECT "account_id", "updated_at" AS at FROM "reference_posts"
      UNION ALL
      SELECT "account_id", "updated_at" AS at FROM "research_keywords"
    ) u GROUP BY "account_id"
  ) r
  WHERE r."account_id" = a."id";
