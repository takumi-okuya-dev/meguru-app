CREATE TYPE "public"."publish_attempt_state" AS ENUM('in_progress', 'retry_wait', 'succeeded', 'carried_over', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."post_draft_status" ADD VALUE 'publishing';--> statement-breakpoint
ALTER TYPE "public"."post_draft_status" ADD VALUE 'published';--> statement-breakpoint
ALTER TYPE "public"."post_draft_status" ADD VALUE 'publish_failed';--> statement-breakpoint
CREATE TABLE "posting_schedules" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"slot_minutes" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"jitter" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"paused_until" timestamp with time zone,
	"blocked_notice_seen_at" timestamp (6) with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_schedules_slot_count" CHECK (cardinality("posting_schedules"."slot_minutes") <= 10),
	CONSTRAINT "posting_schedules_slot_range" CHECK (0 <= ALL("posting_schedules"."slot_minutes") AND 1439 >= ALL("posting_schedules"."slot_minutes")),
	CONSTRAINT "posting_schedules_enabled_requires_slots" CHECK (NOT "posting_schedules"."enabled" OR cardinality("posting_schedules"."slot_minutes") >= 1)
);
--> statement-breakpoint
CREATE TABLE "publish_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"slot_date" date NOT NULL,
	"slot_minute" smallint NOT NULL,
	"draft_id" uuid,
	"is_carryover" boolean DEFAULT false NOT NULL,
	"state" "publish_attempt_state" NOT NULL,
	"skip_reason" text,
	"retry_count" smallint DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"container_id" text,
	"publish_requested_at" timestamp (6) with time zone,
	"last_error" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_attempts_slot_minute_range" CHECK ("publish_attempts"."slot_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "publish_attempts_retry_count_range" CHECK ("publish_attempts"."retry_count" BETWEEN 0 AND 3),
	CONSTRAINT "publish_attempts_skip_state" CHECK (("publish_attempts"."state" = 'skipped' AND "publish_attempts"."skip_reason" IS NOT NULL AND "publish_attempts"."draft_id" IS NULL)
        OR ("publish_attempts"."state" <> 'skipped' AND "publish_attempts"."skip_reason" IS NULL)),
	CONSTRAINT "publish_attempts_skip_reason_valid" CHECK ("publish_attempts"."skip_reason" IS NULL OR "publish_attempts"."skip_reason" IN ('no_drafts', 'needs_reconnect', 'rate_limited', 'daily_limit', 'auto_post_off')),
	CONSTRAINT "publish_attempts_last_error_valid" CHECK ("publish_attempts"."last_error" IS NULL OR "publish_attempts"."last_error" IN ('network', 'threads_server', 'invalid_request', 'container_error', 'unknown')),
	CONSTRAINT "publish_attempts_retry_wait_state" CHECK ("publish_attempts"."state" <> 'retry_wait' OR "publish_attempts"."next_retry_at" IS NOT NULL),
	CONSTRAINT "publish_attempts_pending_has_draft" CHECK ("publish_attempts"."state" NOT IN ('in_progress', 'retry_wait') OR "publish_attempts"."draft_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "post_drafts" DROP CONSTRAINT "post_drafts_review_state";--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "prioritized_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "carryover_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "published_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "threads_media_id" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "threads_permalink" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "publish_failed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "publish_error" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "blocked_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "blocked_words" text[];--> statement-breakpoint
ALTER TABLE "posting_schedules" ADD CONSTRAINT "posting_schedules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posting_schedules_enabled_idx" ON "posting_schedules" USING btree ("enabled") WHERE "posting_schedules"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "publish_attempts_account_slot_unique" ON "publish_attempts" USING btree ("account_id","slot_at");--> statement-breakpoint
CREATE INDEX "publish_attempts_pending_idx" ON "publish_attempts" USING btree ("state","next_retry_at") WHERE "publish_attempts"."state" IN ('in_progress', 'retry_wait');--> statement-breakpoint
CREATE INDEX "publish_attempts_account_date_idx" ON "publish_attempts" USING btree ("account_id","slot_date");--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_carryover_attempt_id_publish_attempts_id_fk" FOREIGN KEY ("carryover_attempt_id") REFERENCES "public"."publish_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_drafts_queue_idx" ON "post_drafts" USING btree ("account_id","status","prioritized_at" DESC NULLS LAST,"reviewed_at","id");--> statement-breakpoint
CREATE INDEX "post_drafts_published_idx" ON "post_drafts" USING btree ("account_id","status","published_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_blocked_state" CHECK (("post_drafts"."blocked_at" IS NULL AND "post_drafts"."blocked_reason" IS NULL AND "post_drafts"."blocked_words" IS NULL)
        OR ("post_drafts"."status"::text = 'needs_review' AND "post_drafts"."blocked_at" IS NOT NULL AND "post_drafts"."blocked_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_blocked_reason_valid" CHECK ("post_drafts"."blocked_reason" IS NULL OR "post_drafts"."blocked_reason" IN ('ng_word', 'over_threads_limit'));--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_publish_error_valid" CHECK ("post_drafts"."publish_error" IS NULL OR "post_drafts"."publish_error" IN ('network', 'threads_server', 'invalid_request', 'container_error', 'unknown'));--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_threads_media_state" CHECK (("post_drafts"."threads_media_id" IS NULL AND "post_drafts"."threads_permalink" IS NULL) OR "post_drafts"."status"::text = 'published');--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_threads_permalink_length" CHECK (char_length("post_drafts"."threads_permalink") <= 2000);--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_review_state" CHECK (("post_drafts"."status"::text = 'needs_review' AND "post_drafts"."reviewed_at" IS NULL AND "post_drafts"."reject_reasons" IS NULL AND "post_drafts"."reject_note" IS NULL
          AND "post_drafts"."prioritized_at" IS NULL AND "post_drafts"."carryover_attempt_id" IS NULL
          AND "post_drafts"."published_at" IS NULL AND "post_drafts"."publish_failed_at" IS NULL AND "post_drafts"."publish_error" IS NULL)
        OR ("post_drafts"."status"::text IN ('approved', 'publishing') AND "post_drafts"."reviewed_at" IS NOT NULL AND "post_drafts"."reject_reasons" IS NULL AND "post_drafts"."reject_note" IS NULL
          AND "post_drafts"."published_at" IS NULL AND "post_drafts"."publish_failed_at" IS NULL AND "post_drafts"."publish_error" IS NULL)
        OR ("post_drafts"."status"::text = 'rejected' AND "post_drafts"."reviewed_at" IS NOT NULL
          AND (coalesce(cardinality("post_drafts"."reject_reasons"), 0) >= 1 OR coalesce(btrim("post_drafts"."reject_note"), '') <> '')
          AND "post_drafts"."prioritized_at" IS NULL AND "post_drafts"."carryover_attempt_id" IS NULL
          AND "post_drafts"."published_at" IS NULL AND "post_drafts"."publish_failed_at" IS NULL AND "post_drafts"."publish_error" IS NULL)
        OR ("post_drafts"."status"::text = 'published' AND "post_drafts"."reviewed_at" IS NOT NULL AND "post_drafts"."reject_reasons" IS NULL AND "post_drafts"."reject_note" IS NULL
          AND "post_drafts"."prioritized_at" IS NULL AND "post_drafts"."carryover_attempt_id" IS NULL
          AND "post_drafts"."published_at" IS NOT NULL AND "post_drafts"."publish_failed_at" IS NULL AND "post_drafts"."publish_error" IS NULL)
        OR ("post_drafts"."status"::text = 'publish_failed' AND "post_drafts"."reviewed_at" IS NOT NULL AND "post_drafts"."reject_reasons" IS NULL AND "post_drafts"."reject_note" IS NULL
          AND "post_drafts"."prioritized_at" IS NULL AND "post_drafts"."carryover_attempt_id" IS NULL
          AND "post_drafts"."published_at" IS NULL AND "post_drafts"."publish_failed_at" IS NOT NULL AND "post_drafts"."publish_error" IS NOT NULL));