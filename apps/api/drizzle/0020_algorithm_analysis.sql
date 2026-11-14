CREATE TABLE "analysis_settings" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"trends_in_prompt" boolean DEFAULT true NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_classifications" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"opening_type" text NOT NULL,
	"theme_id" text,
	"source" text NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_classifications_opening_type_valid" CHECK ("post_classifications"."opening_type" IN ('aruaru', 'question', 'assertion', 'story', 'number', 'announce', 'other')),
	CONSTRAINT "post_classifications_theme_id_valid" CHECK ("post_classifications"."theme_id" IS NULL OR "post_classifications"."theme_id" ~ '^t[0-9a-z]{1,8}$'),
	CONSTRAINT "post_classifications_source_valid" CHECK ("post_classifications"."source" IN ('ai', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "analysis_settings" ADD CONSTRAINT "analysis_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_settings" ADD CONSTRAINT "analysis_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_classifications" ADD CONSTRAINT "post_classifications_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_classifications" ADD CONSTRAINT "post_classifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_classifications" ADD CONSTRAINT "post_classifications_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_classifications_account_idx" ON "post_classifications" USING btree ("account_id");