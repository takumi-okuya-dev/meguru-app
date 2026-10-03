CREATE TYPE "public"."promotion_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."tone_preset" AS ENUM('energetic_casual', 'polite_warm', 'formal', 'casual_frank', 'introspective_calm', 'passionate', 'humorous');--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"target_location" text,
	"target_persona" text,
	"target_age_range" text,
	"cta" text,
	"linked_url" text,
	"priority" smallint DEFAULT 0 NOT NULL,
	"status" "promotion_status" DEFAULT 'active' NOT NULL,
	"valid_until" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_title_length" CHECK (char_length("promotions"."title") BETWEEN 1 AND 100),
	CONSTRAINT "promotions_content_length" CHECK (char_length("promotions"."content") BETWEEN 1 AND 2000),
	CONSTRAINT "promotions_target_location_length" CHECK (char_length("promotions"."target_location") <= 100),
	CONSTRAINT "promotions_target_persona_length" CHECK (char_length("promotions"."target_persona") <= 100),
	CONSTRAINT "promotions_target_age_range_length" CHECK (char_length("promotions"."target_age_range") <= 100),
	CONSTRAINT "promotions_cta_length" CHECK (char_length("promotions"."cta") <= 100),
	CONSTRAINT "promotions_linked_url_length" CHECK (char_length("promotions"."linked_url") <= 2000),
	CONSTRAINT "promotions_priority_range" CHECK ("promotions"."priority" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "reference_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"body" text NOT NULL,
	"keyword" text,
	"post_url" text,
	"why_good" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_posts_body_length" CHECK (char_length("reference_posts"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "reference_posts_keyword_length" CHECK (char_length("reference_posts"."keyword") <= 100),
	CONSTRAINT "reference_posts_post_url_length" CHECK (char_length("reference_posts"."post_url") <= 2000),
	CONSTRAINT "reference_posts_why_good_length" CHECK (char_length("reference_posts"."why_good") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "research_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"keyword_normalized" text NOT NULL,
	"purpose" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_keywords_keyword_length" CHECK (char_length("research_keywords"."keyword") BETWEEN 1 AND 100),
	CONSTRAINT "research_keywords_purpose_length" CHECK (char_length("research_keywords"."purpose") <= 100)
);
--> statement-breakpoint
CREATE TABLE "strategy_designs" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"final_action" text,
	"target_persona" text,
	"real_worries" text,
	"desired_self_image" text,
	"perceived_image" text,
	"content_theme_mix" text,
	"anti_persona" text,
	"benchmark_accounts" text,
	"funnel_design" text,
	"post_genres" text,
	"dm_reply_template" text,
	"inquiry_quality_tips" text,
	"tone_preset" "tone_preset",
	"tone_notes" text,
	"differentiation" text,
	"success_metrics" text,
	"profile_bio_draft" text,
	"pinned_post_draft_1" text,
	"pinned_post_draft_2" text,
	"pinned_post_draft_3" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_designs_final_action_length" CHECK (char_length("strategy_designs"."final_action") <= 2000),
	CONSTRAINT "strategy_designs_target_persona_length" CHECK (char_length("strategy_designs"."target_persona") <= 2000),
	CONSTRAINT "strategy_designs_real_worries_length" CHECK (char_length("strategy_designs"."real_worries") <= 2000),
	CONSTRAINT "strategy_designs_desired_self_image_length" CHECK (char_length("strategy_designs"."desired_self_image") <= 2000),
	CONSTRAINT "strategy_designs_perceived_image_length" CHECK (char_length("strategy_designs"."perceived_image") <= 2000),
	CONSTRAINT "strategy_designs_content_theme_mix_length" CHECK (char_length("strategy_designs"."content_theme_mix") <= 2000),
	CONSTRAINT "strategy_designs_anti_persona_length" CHECK (char_length("strategy_designs"."anti_persona") <= 2000),
	CONSTRAINT "strategy_designs_benchmark_accounts_length" CHECK (char_length("strategy_designs"."benchmark_accounts") <= 2000),
	CONSTRAINT "strategy_designs_funnel_design_length" CHECK (char_length("strategy_designs"."funnel_design") <= 2000),
	CONSTRAINT "strategy_designs_post_genres_length" CHECK (char_length("strategy_designs"."post_genres") <= 2000),
	CONSTRAINT "strategy_designs_dm_reply_template_length" CHECK (char_length("strategy_designs"."dm_reply_template") <= 2000),
	CONSTRAINT "strategy_designs_inquiry_quality_tips_length" CHECK (char_length("strategy_designs"."inquiry_quality_tips") <= 2000),
	CONSTRAINT "strategy_designs_tone_notes_length" CHECK (char_length("strategy_designs"."tone_notes") <= 2000),
	CONSTRAINT "strategy_designs_differentiation_length" CHECK (char_length("strategy_designs"."differentiation") <= 2000),
	CONSTRAINT "strategy_designs_success_metrics_length" CHECK (char_length("strategy_designs"."success_metrics") <= 2000),
	CONSTRAINT "strategy_designs_profile_bio_draft_length" CHECK (char_length("strategy_designs"."profile_bio_draft") <= 2000),
	CONSTRAINT "strategy_designs_pinned_post_draft_1_length" CHECK (char_length("strategy_designs"."pinned_post_draft_1") <= 2000),
	CONSTRAINT "strategy_designs_pinned_post_draft_2_length" CHECK (char_length("strategy_designs"."pinned_post_draft_2") <= 2000),
	CONSTRAINT "strategy_designs_pinned_post_draft_3_length" CHECK (char_length("strategy_designs"."pinned_post_draft_3") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "promotion_ratio_percent" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_keywords" ADD CONSTRAINT "research_keywords_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD CONSTRAINT "strategy_designs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotions_account_idx" ON "promotions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "reference_posts_account_created_idx" ON "reference_posts" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "research_keywords_account_keyword_unique" ON "research_keywords" USING btree ("account_id","keyword_normalized");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_promotion_ratio_range" CHECK ("accounts"."promotion_ratio_percent" BETWEEN 0 AND 100);