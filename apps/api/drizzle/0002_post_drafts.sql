CREATE TYPE "public"."post_draft_status" AS ENUM('needs_review');--> statement-breakpoint
CREATE TABLE "draft_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"draft_count" smallint NOT NULL,
	"delimiter_found" boolean NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_batches_draft_count_range" CHECK ("draft_batches"."draft_count" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "post_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"body" text NOT NULL,
	"status" "post_draft_status" DEFAULT 'needs_review' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_drafts_position_range" CHECK ("post_drafts"."position" >= 0 AND "post_drafts"."position" < 50),
	CONSTRAINT "post_drafts_body_length" CHECK (char_length("post_drafts"."body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "prompt_post_count" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_batches" ADD CONSTRAINT "draft_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_batch_id_draft_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."draft_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_batches_account_request_unique" ON "draft_batches" USING btree ("account_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_drafts_batch_position_unique" ON "post_drafts" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "post_drafts_account_status_idx" ON "post_drafts" USING btree ("account_id","status");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_prompt_post_count_range" CHECK ("accounts"."prompt_post_count" BETWEEN 1 AND 50);