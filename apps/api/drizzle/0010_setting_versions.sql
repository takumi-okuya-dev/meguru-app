ALTER TABLE "accounts" ADD COLUMN "promotion_ratio_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "promotion_ratio_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "prompt_post_count_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "prompt_post_count_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_promotion_ratio_updated_by_user_id_users_id_fk" FOREIGN KEY ("promotion_ratio_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_prompt_post_count_updated_by_user_id_users_id_fk" FOREIGN KEY ("prompt_post_count_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;