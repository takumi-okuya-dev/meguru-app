ALTER TYPE "public"."post_draft_status" ADD VALUE 'approved';--> statement-breakpoint
ALTER TYPE "public"."post_draft_status" ADD VALUE 'rejected';--> statement-breakpoint
CREATE TABLE "ng_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"word" text NOT NULL,
	"normalized" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ng_words_word_length" CHECK (char_length("ng_words"."word") BETWEEN 1 AND 50)
);
--> statement-breakpoint
DROP INDEX "post_drafts_account_status_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "core_rules" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "core_rules_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "reviewed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "reject_reasons" text[];--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "reject_note" text;--> statement-breakpoint
ALTER TABLE "ng_words" ADD CONSTRAINT "ng_words_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ng_words_account_normalized_unique" ON "ng_words" USING btree ("account_id","normalized");--> statement-breakpoint
CREATE INDEX "post_drafts_account_status_reviewed_idx" ON "post_drafts" USING btree ("account_id","status","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_core_rules_length" CHECK (char_length("accounts"."core_rules") <= 2000);--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_reject_note_length" CHECK (char_length("post_drafts"."reject_note") <= 200);--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_review_state" CHECK (("post_drafts"."status"::text = 'needs_review' AND "post_drafts"."reviewed_at" IS NULL AND "post_drafts"."reject_reasons" IS NULL AND "post_drafts"."reject_note" IS NULL)
        OR ("post_drafts"."status"::text = 'approved' AND "post_drafts"."reviewed_at" IS NOT NULL AND "post_drafts"."reject_reasons" IS NULL AND "post_drafts"."reject_note" IS NULL)
        OR ("post_drafts"."status"::text = 'rejected' AND "post_drafts"."reviewed_at" IS NOT NULL
          AND (coalesce(cardinality("post_drafts"."reject_reasons"), 0) >= 1 OR coalesce(btrim("post_drafts"."reject_note"), '') <> '')));