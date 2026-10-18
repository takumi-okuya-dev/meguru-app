ALTER TABLE "accounts" ADD COLUMN "post_length_target" smallint DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "short_length" smallint DEFAULT 55 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "medium_length" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "long_length" smallint DEFAULT 135 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "short_ratio" smallint DEFAULT 35 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "medium_ratio" smallint DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "long_ratio" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "platform" text DEFAULT 'threads' NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "posted_date_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "posted_date" date;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "metric_likes" integer;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "metric_replies" integer;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "metric_views" integer;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "metric_saves" integer;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "metric_reposts" integer;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "metric_followers" integer;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "reference_posts" ADD COLUMN "memo" text;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "purpose_origin" text;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "purpose_self" text;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "purpose_others" text;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "purpose_future" text;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "purpose_stance" text;--> statement-breakpoint
ALTER TABLE "strategy_designs" ADD COLUMN "activity_axis" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_post_length_target_range" CHECK ("accounts"."post_length_target" BETWEEN 50 AND 500);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_post_kind_length_range" CHECK ("accounts"."short_length" BETWEEN 10 AND "accounts"."post_length_target" AND "accounts"."medium_length" BETWEEN 10 AND "accounts"."post_length_target" AND "accounts"."long_length" BETWEEN 10 AND "accounts"."post_length_target");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_post_kind_ratio_range" CHECK ("accounts"."short_ratio" BETWEEN 0 AND 100 AND "accounts"."medium_ratio" BETWEEN 0 AND 100 AND "accounts"."long_ratio" BETWEEN 0 AND 100 AND "accounts"."short_ratio" + "accounts"."medium_ratio" + "accounts"."long_ratio" = 100);--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_platform_valid" CHECK ("reference_posts"."platform" IN ('threads', 'instagram', 'tiktok', 'x', 'other'));--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_posted_date_mode_valid" CHECK ("reference_posts"."posted_date_mode" IN ('exact', 'week', 'month', '3months', 'unknown'));--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_posted_date_matches_mode" CHECK (("reference_posts"."posted_date_mode" = 'exact') = ("reference_posts"."posted_date" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_metrics_nonnegative" CHECK (coalesce("reference_posts"."metric_likes", 0) >= 0 AND coalesce("reference_posts"."metric_replies", 0) >= 0 AND coalesce("reference_posts"."metric_views", 0) >= 0 AND coalesce("reference_posts"."metric_saves", 0) >= 0 AND coalesce("reference_posts"."metric_reposts", 0) >= 0 AND coalesce("reference_posts"."metric_followers", 0) >= 0);--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_author_length" CHECK (char_length("reference_posts"."author") <= 100);--> statement-breakpoint
ALTER TABLE "reference_posts" ADD CONSTRAINT "reference_posts_memo_length" CHECK (char_length("reference_posts"."memo") <= 500);