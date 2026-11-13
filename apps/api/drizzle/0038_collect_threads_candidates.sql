-- 集金管理の Threads のイベントの候補（specs/collect/001-event-day-collection data-model.md 2-10、tasks.md T075）。
-- 新しい表を作るだけ。今の表は変えない。
CREATE TABLE "collect"."threads_event_candidates" (
	"promotion_id" text PRIMARY KEY NOT NULL,
	"threads_account_id" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue" text,
	"capacity" integer,
	"fee_amount" integer,
	"fee_note" text,
	"posted_media" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"deleted_at" timestamp with time zone,
	"details_occurred_at" timestamp (6) with time zone NOT NULL,
	"media_occurred_at" timestamp (6) with time zone
);
--> statement-breakpoint
CREATE INDEX "threads_event_candidates_owner_idx" ON "collect"."threads_event_candidates" USING btree ("owner_user_id","starts_at");